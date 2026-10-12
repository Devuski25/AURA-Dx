"""Decision-table tests for the cross-recording fusion step.

Run without any ML dependency installed:

    python packages/inference/test_fusion.py

FastAPI, Pydantic, librosa and scipy are stubbed at import time so this only
needs numpy. The point is to pin down the safety behaviour: a single
high-confidence pneumonia take must win over a healthy-looking mean.

Note these tests exercise `fuse_clips` only — the pure decision logic. They do
not run either model, so they cannot tell you whether the feature vector fed to
Stage 1 matches the one it was trained on. See the warning in README.md.
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
    print("thresholds: stage1_healthy=%s stage2_copd=%s override=%s" % (
        svc.STAGE1_HEALTHY_THRESHOLD,
        svc.STAGE2_COPD_THRESHOLD,
        svc.STAGE2_OVERRIDE_THRESHOLD,
    ))
    print(f"\n{'ALL PASS' if failures == 0 else str(failures) + ' FAILURE(S)'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())