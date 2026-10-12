"""Tests for the fusion decision table and the notebook-derived preprocessing.

Run without any ML dependency installed:

    python packages/inference/test_fusion.py

FastAPI, Pydantic, librosa and scipy are stubbed at import time so this only
needs numpy. Two things are pinned down here:

  1. Fusion — a single high-confidence pneumonia take must win over a
     healthy-looking mean.
  2. Preprocessing shapes and constants, which must match
     `final icbhi nb.ipynb` exactly. Getting these wrong does not raise, it just
     feeds the models numbers they were never trained on.

These tests do not run either model, so they cannot tell you whether the models
themselves are any good. See the warning in README.md.
"""
import importlib.util
import sys
import types
from pathlib import Path

import numpy as np

SERVICE_PATH = Path(__file__).resolve().parent / "inference_service.py"


def _load_service():
    """Import inference_service with every non-numpy dependency stubbed out."""
    for name in ["librosa", "fastapi", "fastapi.responses",
                 "fastapi.security", "pydantic", "scipy", "scipy.signal"]:
        sys.modules.setdefault(name, types.ModuleType(name))

    class _BaseModel:
        def __init__(self, **kwargs):
            for k, v in kwargs.items():
                setattr(self, k, v)

    class _FakeApp:
        """Stands in for FastAPI so the route decorators become no-ops."""

        def __init__(self, *a, **k):
            pass

        def on_event(self, *a, **k):
            return lambda fn: fn

        def post(self, *a, **k):
            return lambda fn: fn

        def get(self, *a, **k):
            return lambda fn: fn

    def _anything(*a, **k):
        """File(...) / Depends(...) / Security(...) default-argument placeholders."""
        return None

    sys.modules["pydantic"].BaseModel = _BaseModel
    sys.modules["fastapi"].FastAPI = _FakeApp
    sys.modules["fastapi"].File = _anything
    sys.modules["fastapi"].Depends = _anything
    sys.modules["fastapi"].Security = _anything
    sys.modules["fastapi"].UploadFile = object
    sys.modules["fastapi"].HTTPException = Exception
    responses_mod = sys.modules["fastapi.responses"]
    responses_mod.JSONResponse = object
    security_mod = sys.modules["fastapi.security"]
    security_mod.APIKeyHeader = lambda **k: None
    sys.modules["scipy.signal"].butter = None
    sys.modules["scipy.signal"].filtfilt = None

    spec = importlib.util.spec_from_file_location("inference_service", SERVICE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


svc = _load_service()


def clip(index, label, healthy, pneumonia, copd):
    """Build one per-recording result in the shape score_single_clip returns."""
    return {
        "index": index,
        "clip_label": label,
        "healthy_prob": healthy,
        "pneumonia_prob": pneumonia,
        "copd_prob": copd,
        "stage1_routed_to_stage2": label != "Healthy",
    }


CASES = [
    # (name, clips, expected label, expected override)
    ("all takes healthy",
     [clip(i, "Healthy", 1.0, 0.0, 0.0) for i in range(5)],
     "Healthy", None),

    ("all takes COPD",
     [clip(i, "COPD", 0.0, 0.20, 0.80) for i in range(3)],
     "COPD", None),

    ("all takes pneumonia",
     [clip(i, "Pneumonia", 0.0, 0.80, 0.20) for i in range(3)],
     "Pneumonia", "single_clip_high_confidence_pneumonia"),

    # --- the safety behaviour these thresholds exist for ---
    ("four healthy + one confident pneumonia -> Pneumonia",
     [clip(0, "Pneumonia", 0.0, 0.95, 0.05)]
     + [clip(i, "Healthy", 1.0, 0.0, 0.0) for i in range(1, 5)],
     "Pneumonia", "single_clip_high_confidence_pneumonia"),

    ("mean looks healthy but one take is 0.62 -> Pneumonia",
     [clip(0, "Pneumonia", 0.0, 0.62, 0.38)]
     + [clip(i, "Healthy", 1.0, 0.0, 0.0) for i in range(1, 5)],
     "Pneumonia", "single_clip_high_confidence_pneumonia"),

    ("one take below the override -> mean governs, stays Healthy",
     [clip(0, "Pneumonia", 0.0, 0.55, 0.45)]
     + [clip(i, "Healthy", 1.0, 0.0, 0.0) for i in range(1, 5)],
     "Healthy", None),

    # --- mean governs when nothing is decisive ---
    ("pneumonia leads on the mean, no override",
     [clip(0, "Pneumonia", 0.0, 0.58, 0.42),
      clip(1, "Pneumonia", 0.0, 0.55, 0.45),
      clip(2, "Pneumonia", 0.0, 0.52, 0.48)],
     "Pneumonia", None),

    ("COPD leads on the mean",
     [clip(0, "Pneumonia", 0.0, 0.40, 0.60),
      clip(1, "COPD", 0.0, 0.30, 0.70),
      clip(2, "COPD", 0.0, 0.20, 0.80)],
     "COPD", None),

    # --- boundary behaviour, pinned so a threshold tweak is visible ---
    ("override boundary is inclusive at exactly 0.60",
     [clip(0, "Pneumonia", 0.0, 0.60, 0.40)]
     + [clip(i, "COPD", 0.0, 0.10, 0.90) for i in range(1, 4)],
     "Pneumonia", "single_clip_high_confidence_pneumonia"),

    ("just under the boundary -> mean governs, COPD wins",
     [clip(0, "Pneumonia", 0.0, 0.59, 0.41)]
     + [clip(i, "COPD", 0.0, 0.10, 0.90) for i in range(1, 4)],
     "COPD", None),

    # --- the API allows fewer than MIN_TAKES, so fusion must not assume 3+ ---
    ("single take",
     [clip(0, "COPD", 0.0, 0.25, 0.75)],
     "COPD", None),
]


def main() -> int:
    failures = 0
    for name, clips, want_label, want_override in CASES:
        out = svc.fuse_clips(clips)
        got_label = out["label"]
        got_override = out["fusion"]["override_applied"]
        total = sum(out["probabilities"].values())

        problems = []
        if got_label != want_label:
            problems.append(f"label {got_label!r} != {want_label!r}")
        if got_override != want_override:
            problems.append(f"override {got_override!r} != {want_override!r}")
        if not abs(total - 1.0) < 0.002:
            problems.append(f"probabilities sum to {total:.4f}, expected 1.0")
        if out["fusion"]["recordings_fused"] != len(clips):
            problems.append(f"recordings_fused {out['fusion']['recordings_fused']} != {len(clips)}")

        if problems:
            failures += 1
            print(f"[FAIL] {name}")
            for p in problems:
                print(f"         - {p}")
        else:
            print(f"[PASS] {name}  -> {got_label} ({out['confidence']})")

    print()
    failures += _check_preprocessing()
    failures += _check_segmentation()

    print()
    print("thresholds: stage1_healthy=%s stage2_pneumonia=%s override=%s" % (
        svc.STAGE1_HEALTHY_THRESHOLD,
        svc.STAGE2_PNEUMONIA_THRESHOLD,
        svc.STAGE2_OVERRIDE_THRESHOLD,
    ))
    print(f"\n{'ALL PASS' if failures == 0 else str(failures) + ' FAILURE(S)'}")
    return 1 if failures else 0


# --------------------------------------------------------------------------
# Preprocessing contract — must match `final icbhi nb.ipynb`
# --------------------------------------------------------------------------
def _report(label, problems):
    if problems:
        print(f"[FAIL] {label}")
        for p in problems:
            print(f"         - {p}")
        return 1
    print(f"[PASS] {label}")
    return 0


def _check_preprocessing() -> int:
    """Constants and tensor shape. These are silent-failure guards: none of
    them raise if wrong, they just feed the models out-of-distribution input.
    """
    failures = 0

    checks = [
        ("sample rate is 16 kHz", svc.SAMPLE_RATE, 16000),
        ("stage 1 bandpass 100 Hz low", svc.BANDPASS_LOW_HZ, 100.0),
        ("stage 1 bandpass 2000 Hz high", svc.BANDPASS_HIGH_HZ, 2000.0),
        ("stage 1 bandpass order 4", svc.BANDPASS_ORDER, 4),
        ("stage 1 n_mfcc 13", svc.N_MFCC, 13),
        ("stage 1 vector is 153-d", svc.STAGE1_FEATURE_DIM, 153),
        ("stage 1 window 2.5 s", svc.STAGE1_WINDOW_SEC, 2.5),
        ("stage 1 hop 1.25 s", svc.STAGE1_HOP_SEC, 1.25),
        ("stage 1 min segment 0.2 s", svc.STAGE1_MIN_SEGMENT_SEC, 0.2),
        ("stage 2 n_mels 64", svc.STAGE2_N_MELS, 64),
        ("stage 2 n_fft 1024", svc.STAGE2_N_FFT, 1024),
        ("stage 2 hop 256", svc.STAGE2_HOP, 256),
        ("stage 2 fmin 50 Hz", svc.STAGE2_FMIN, 50.0),
        ("stage 2 fmax 2000 Hz", svc.STAGE2_FMAX, 2000.0),
        ("stage 2 target 128 frames", svc.STAGE2_TARGET_FRAMES, 128),
        ("stage 2 3 channels", svc.STAGE2_CHANNELS, 3),
        ("stage 2 dB floor -80", svc.STAGE2_DB_FLOOR, -80.0),
        ("stage 1 threshold 0.61", svc.STAGE1_HEALTHY_THRESHOLD, 0.61),
        ("stage 2 threshold 0.47", svc.STAGE2_PNEUMONIA_THRESHOLD, 0.47),
        ("override threshold 0.60", svc.STAGE2_OVERRIDE_THRESHOLD, 0.60),
        # 128 frames * 256 hop / 16000 = one annotated respiratory cycle
        ("stage 2 window is one cycle (2.048 s)",
         round(svc.STAGE2_WINDOW_SEC, 3), 2.048),
    ]

    for label, got, want in checks:
        if got != want:
            failures += _report(label, [f"{got!r} != {want!r} (notebook value)"])
        else:
            print(f"[PASS] {label}")

    return failures


def _check_segmentation() -> int:
    """Windowing arithmetic, which decides how many Stage 2 passes a take gets."""
    failures = 0
    sr = svc.SAMPLE_RATE

    def _len(seconds):
        return int(round(seconds * sr))

    cases = [
        # 2.048 s window, 50% overlap -> 1.024 s hop.
        # (label, audio seconds, expected window count)
        ("2.0 s take -> 1 window", 2.0, 1),
        ("one cycle (2.048 s) -> 1 window", svc.STAGE2_WINDOW_SEC, 1),
        ("5 s take -> 4 windows", 5.0, 4),
        ("12 s take -> 11 windows", 12.0, 11),
    ]

    for label, seconds, expected in cases:
        audio = np.zeros(_len(seconds))
        got = len(svc.stage2_windows(audio))
        # A very short take still yields exactly one padded window.
        if got != expected:
            failures += _report(label, [f"{got} windows, expected {expected}"])
        else:
            print(f"[PASS] {label} ({got})")

    # A pathologically long take must still be bounded, or one upload can pin
    # the inference worker through hundreds of EfficientNet passes.
    long_take = np.zeros(_len(300.0))
    got = len(svc.stage2_windows(long_take))
    if got > svc.STAGE2_MAX_WINDOWS:
        failures += _report(
            "300 s take stays under the window cap",
            [f"{got} windows, cap is {svc.STAGE2_MAX_WINDOWS}"],
        )
    else:
        print(f"[PASS] 300 s take stays under the window cap ({got})")

    # Windows must never exceed the training length, or the padding branch is
    # being fed a distribution the model never saw.
    audio = np.zeros(_len(20.0))
    for w in svc.stage2_windows(audio):
        if len(w) > _len(svc.STAGE2_WINDOW_SEC):
            failures += _report("windows never exceed one cycle", [f"got {len(w)} samples"])
            break
    else:
        print("[PASS] windows never exceed one cycle")

    return failures


if __name__ == "__main__":
    sys.exit(main())