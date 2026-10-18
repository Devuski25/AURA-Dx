#!/usr/bin/env python3
"""Interpretation tests: model scores -> clinically-shaped verdict.

Split out from test_fusion.py so the decision table and the presentation bands
can fail independently. test_fusion pins the three-class fusion; this pins what
that fusion is *called* once it reaches a clinician.

    python packages/inference/test_interpretation.py

Numpy only. No model is loaded, so nothing here says whether the models are any
good -- only whether the numbers are reported correctly and consistently.
"""
import importlib.util
import sys
import types
from pathlib import Path

import numpy as np

SERVICE_PATH = Path(__file__).resolve().parent / "inference_service.py"


def _load_service():
    for name in ["librosa", "fastapi", "fastapi.responses",
                 "fastapi.security", "pydantic", "scipy", "scipy.signal"]:
        sys.modules.setdefault(name, types.ModuleType(name))

    class _BaseModel:
        def __init__(self, **kwargs):
            for k, v in kwargs.items():
                setattr(self, k, v)

    class _FakeApp:
        def __init__(self, *a, **k):
            pass
        def on_event(self, *a, **k):
            return lambda fn: fn
        def post(self, *a, **k):
            return lambda fn: fn
        def get(self, *a, **k):
            return lambda fn: fn

    def _anything(*a, **k):
        return None

    sys.modules["pydantic"].BaseModel = _BaseModel
    sys.modules["fastapi"].FastAPI = _FakeApp
    sys.modules["fastapi"].File = _anything
    sys.modules["fastapi"].Depends = _anything
    sys.modules["fastapi"].Security = _anything
    sys.modules["fastapi"].UploadFile = object
    sys.modules["fastapi"].HTTPException = Exception
    sys.modules["fastapi.responses"].JSONResponse = _anything
    sys.modules["fastapi.security"].APIKeyHeader = lambda **k: None
    sys.modules["scipy.signal"].butter = None
    sys.modules["scipy.signal"].filtfilt = None

    spec = importlib.util.spec_from_file_location("inference_service", SERVICE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


svc = _load_service()


def healthy(i):
    """A recording Stage 1 called normal: it never reaches Stage 2."""
    return {
        "index": i, "clip_label": "Healthy",
        "healthy_prob": 1.0, "pneumonia_prob": 0.0, "copd_prob": 0.0,
        "stage1_routed_to_stage2": False,
    }


def flagged(i, pneumonia):
    """A recording that reached Stage 2, with a given pneumonia probability."""
    return {
        "index": i,
        "clip_label": "Pneumonia" if pneumonia >= 0.47 else "COPD",
        "healthy_prob": 0.0,
        "pneumonia_prob": pneumonia,
        "copd_prob": 1.0 - pneumonia,
        "stage1_routed_to_stage2": True,
    }


# (name, clips, expected status, expected confidence level)
CASES = [
    # --- Healthy -----------------------------------------------------------
    ("all five normal -> Healthy, High",
     [healthy(i) for i in range(5)], "HEALTHY", "HIGH"),

    # Four normal plus one that reached Stage 2 and came back clean. The
    # majority is clearly normal, but a fifth of the readings did not agree,
    # so this must not read as High. This is the documented weakness of
    # majority-averaging: one mildly abnormal take below the 0.60 alert
    # threshold cannot overturn four normal ones.
    ("four normal + one clean flag -> Healthy, not High",
     [healthy(i) for i in range(4)] + [flagged(4, 0.0)], "HEALTHY", "LOW"),

    # 3 healthy + 2 flagged => mean_healthy 0.60, inside the borderline band.
    ("three normal + two borderline -> Healthy, Low",
     [healthy(i) for i in range(3)] + [flagged(3, 0.35), flagged(4, 0.30)],
     "HEALTHY", "LOW"),

    # 4 healthy + 1 flagged => mean_healthy 0.80, above the threshold but with
    # a flagged recording present, so confidence is cut.
    ("four normal + one borderline -> Healthy, not High",
     [healthy(i) for i in range(4)] + [flagged(4, 0.30)], "HEALTHY", "LOW"),

    # --- COPD -------------------------------------------------------------
    ("five strongly COPD -> COPD, High",
     [flagged(i, 0.15) for i in range(5)], "COPD", "HIGH"),

    ("moderate COPD -> COPD, Moderate",
     [flagged(i, 0.42) for i in range(5)], "COPD", "MODERATE"),

    # --- Pneumonia --------------------------------------------------------
    ("five strongly pneumonia -> Pneumonia, High (override)",
     [flagged(i, 0.80) for i in range(5)], "PNEUMONIA", "HIGH"),

    ("four normal + one 0.72 -> Pneumonia, High (override wins)",
     [healthy(i) for i in range(4)] + [flagged(4, 0.72)], "PNEUMONIA", "HIGH"),

    ("override sits above the Moderate boundary",
     [healthy(i) for i in range(4)] + [flagged(4, 0.62)], "PNEUMONIA", "HIGH"),

    # --- Atypical ----------------------------------------------------------
    # Averaging to 0.48 pneumonia / 0.52 COPD -- either side of the boundary.
    # Every value stays under 0.60 so the single-take override cannot fire;
    # including one at exactly 0.60 here would test the override, not the band.
    ("evenly split around the boundary -> Atypical, Low",
     [flagged(i, p) for i, p in enumerate([0.35, 0.42, 0.50, 0.55, 0.58])],
     "ATYPICAL_OOD", "LOW"),

    ("exactly on the 0.50 boundary -> Atypical",
     [flagged(i, 0.50) for i in range(3)], "ATYPICAL_OOD", "LOW"),

    # --- Agreement downgrade ----------------------------------------------
    # mean leans COPD clearly, but the recordings contradict each other.
    ("split readings, clear mean -> COPD downgraded to Moderate",
     [flagged(i, p) for i, p in enumerate([0.05, 0.08, 0.10, 0.55, 0.58])],
     "COPD", "MODERATE"),

    # Close readings: no downgrade, because there is nothing to disagree about.
    ("agreeing readings stay High",
     [flagged(i, 0.12) for i in range(5)], "COPD", "HIGH"),
]


def main() -> int:
    failures = 0
    print("=== interpretation ===")
    for name, clips, want_status, want_level in CASES:
        out = svc.fuse_clips(clips)
        interp = out["interpretation"]

        problems = []
        if interp["status"] != want_status:
            problems.append(f"status {interp['status']!r} != {want_status!r}")
        if interp["confidence_level"] != want_level:
            problems.append(
                f"confidence {interp['confidence_level']!r} != {want_level!r}"
            )
        if interp["recordings_total"] != len(clips):
            problems.append("recordings_total wrong")
        expected_flagged = sum(1 for c in clips if c["stage1_routed_to_stage2"])
        if interp["recordings_flagged"] != expected_flagged:
            problems.append("recordings_flagged wrong")

        if problems:
            failures += 1
            print(f"[FAIL] {name}")
            for p in problems:
                print(f"         - {p}")
        else:
            print(f"[PASS] {name}  -> {interp['status']} ({interp['confidence_level']})"
                  f"  rule={interp['decision_rule']}")

    # -----------------------------------------------------------------------
    # Invariant: reading the class off the conditional average must agree with
    # the existing fused comparison, in both directions. This is what licenses
    # recalibrating the bands against 0.5 instead of touching the class logic.
    # -----------------------------------------------------------------------
    print()
    print("=== conditional-average equivalence ===")
    mismatches = 0
    grid = np.arange(0.02, 0.99, 0.02)
    for n_healthy in range(0, 5):
        for n_flagged in range(1, 6 - n_healthy):
            for p in grid:
                clips = [healthy(i) for i in range(n_healthy)]
                clips += [flagged(n_healthy + j, float(p)) for j in range(n_flagged)]
                out = svc.fuse_clips(clips)
                if out["fusion"]["override_applied"] or out["label"] == "Healthy":
                    continue
                # `>=` because fuse_clips resolves the tie to COPD
                # (`elif mean_pneumonia > mean_copd: ... else: COPD`). Using a
                # strict `>` here would report a disagreement at exactly 0.50
                # that the real code does not have.
                fused_copd = out["probabilities"]["COPD"] >= out["probabilities"]["Pneumonia"]
                cond = out["interpretation"]["band_metric"] == "conditional_copd"
                if cond:
                    stage2 = [c for c in clips if c["stage1_routed_to_stage2"]]
                    conditional_copd = 1.0 - float(np.mean([c["pneumonia_prob"] for c in stage2]))
                    conditional_copd_class = conditional_copd >= 0.5
                    if fused_copd != conditional_copd_class:
                        mismatches += 1
                        if mismatches <= 3:
                            print(f"[FAIL] fused={fused_copd} conditional={conditional_copd_class}"
                                  f" at healthy={n_healthy} flagged={n_flagged} p={p:.2f}")
    if mismatches:
        failures += 1
        print(f"         - {mismatches} disagreement(s) between fused and conditional")
    else:
        print("[PASS] fused and conditional class choice agree across the whole grid")

    print()
    print("bands: healthy_high=%s healthy_lower=%s copd_high=%s pneumonia_high=%s" % (
        svc.HEALTHY_HIGH_POINT, svc.HEALTHY_LOWER_POINT,
        svc.COPD_HIGH_POINT, svc.PNEUMONIA_HIGH_POINT,
    ))
    print(f"\n{'ALL PASS' if failures == 0 else str(failures) + ' FAILURE(S)'}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
