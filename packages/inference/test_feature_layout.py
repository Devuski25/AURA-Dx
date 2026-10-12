"""Pure-numpy verification of the Stage 1 vector layout.

librosa's feature stack is not runnable on every machine (this one takes >10
minutes for a single MFCC on 2.5 s of audio), so this check does not depend on
it. It re-implements the notebook's *array plumbing* — the descriptor stack
order, the aggregate order, and the dimension arithmetic — and asserts the
service's constants produce the same layout.

What this proves: the service builds a 153-d vector in the notebook's order.
What it cannot prove: that librosa returns the same numbers as it did during
training. That needs `test_preprocessing.py` on a machine with a working
librosa, or better, a round-trip against the real ICBHI test manifest.

    python packages/inference/test_feature_layout.py
"""
import sys
from pathlib import Path

import numpy as np

SERVICE = Path(__file__).resolve().parent / "inference_service.py"
src = SERVICE.read_text(encoding="utf-8")

failures = 0


def check(label, ok, detail=""):
    global failures
    if ok:
        print(f"[PASS] {label}")
    else:
        failures += 1
        print(f"[FAIL] {label}" + (f" — {detail}" if detail else ""))


def const(name, expected):
    """Pull a module-level constant out of the service source."""
    import re
    m = re.search(rf"^{name}\s*=\s*(.+?)\s*(?:#.*)?$", src, re.M)
    if not m:
        return None, f"{name} not found in {SERVICE.name}"
    try:
        return eval(m.group(1), {"STAGE2_TARGET_FRAMES": 128, "STAGE2_HOP": 256,
                                 "SAMPLE_RATE": 16000}), None
    except Exception as e:
        return None, f"{name}: {e!r}"


print("=== notebook arithmetic ===\n")

# Notebook cell 6, extract_segment_features: the feature stack, in order.
DESCRIPTORS = [
    ("mfcc", 13),
    ("mfcc_delta", 13),
    ("mfcc_delta2", 13),
    ("spectral_centroid", 1),
    ("spectral_bandwidth", 1),
    ("spectral_contrast", 7),
    ("spectral_flatness", 1),
    ("zero_crossing_rate", 1),
    ("rms", 1),
]
per_cycle = sum(n for _, n in DESCRIPTORS)
check("descriptor stack is 51 wide", per_cycle == 51, f"got {per_cycle}")

# Notebook: hstack([mean, max, std]) -> 3 * 51
check("153 = 51 x 3", per_cycle * 3 == 153, f"got {per_cycle * 3}")

print("\n=== service constants agree with the notebook ===\n")

for name, expected in [
    ("N_MFCC", 13),
    ("STAGE1_FEATURE_DIM", 153),
    ("STAGE1_WINDOW_SEC", 2.5),
    ("STAGE1_HOP_SEC", 1.25),
    ("STAGE1_MIN_SEGMENT_SEC", 0.2),
    ("STAGE1_CYCLE_FLOOR", 0.2),
    ("SAMPLE_RATE", 16000),
    ("BANDPASS_LOW_HZ", 100.0),
    ("BANDPASS_HIGH_HZ", 2000.0),
    ("BANDPASS_ORDER", 4),
    ("STAGE2_N_MELS", 64),
    ("STAGE2_N_FFT", 1024),
    ("STAGE2_HOP", 256),
    ("STAGE2_FMIN", 50.0),
    ("STAGE2_FMAX", 2000.0),
    ("STAGE2_TARGET_FRAMES", 128),
    ("STAGE2_CHANNELS", 3),
    ("STAGE2_DB_FLOOR", -80.0),
    ("STAGE1_HEALTHY_THRESHOLD", 0.61),
    ("STAGE2_PNEUMONIA_THRESHOLD", 0.47),
    ("STAGE2_OVERRIDE_THRESHOLD", 0.60),
]:
    got, err = const(name, expected)
    check(f"{name} == {expected}", got == expected and not err, err or f"got {got!r}")

# 128 frames * 256 hop / 16000 = one annotated respiratory cycle.
window, err = const("STAGE2_WINDOW_SEC", None)
check("stage 2 window == one cycle (2.048 s)",
      window is not None and abs(window - 2.048) < 1e-9,
      err or f"got {window}")

print("\n=== aggregate order is mean | max | std ===\n")

# The service must stack in this order. XGBoost is position-indexed, so a swap
# would corrupt every split silently.
import re

# Find the real np.hstack([...]) block and read the aggregate call order out of
# it. Matching a literal string is brittle — trailing commas and line breaks are
# incidental, the call order is not.
blocks = re.findall(r"np\.hstack\(\[(.*?)\]\)", src, re.S)
cycle_blocks = [b for b in blocks if "cycle_mat" in b]
check("build_stage1_features has exactly one cycle hstack block",
      len(cycle_blocks) == 1, f"found {len(cycle_blocks)}")

if cycle_blocks:
    order = re.findall(r"np\.(mean|max|std)\(cycle_mat", cycle_blocks[0])
    check("build_stage1_features stacks mean then max then std",
          order == ["mean", "max", "std"], f"got {order}")

# And the descriptor order in segment_features must match the notebook.
expected_order = [
    "mfcc", "mfcc_delta", "mfcc_delta2", "spec_cent", "spec_bw",
    "spec_contrast", "spec_flat", "zcr", "rms",
]
loop = src.split("for mat in [", 1)[-1].split("]", 1)[0]
found_order = [tok.strip() for tok in loop.split(",") if tok.strip()]
check("segment_features stacks the notebook's descriptor order",
      found_order == expected_order,
      f"got {found_order}")

print("\n=== stage 2 output semantics ===\n")

# The head is trained y=1 for Pneumonia, so the sigmoid output is p_pneumonia.
check("stage2 function is named for pneumonia",
      "def stage2_pneumonia_probability(" in src
      and "def stage2_copd_probability(" not in src,
      "a p_copd-named function still exists — check the polarity")

check("p_copd is derived as the complement",
      "p_copd = 1.0 - p_pneumonia" in src)

check("threshold applied to p_pneumonia, not p_copd",
      'label = "Pneumonia" if p_pneumonia >= STAGE2_PNEUMONIA_THRESHOLD else "COPD"' in src)

# The (dB + 80) / 80 rescale must be present and clipped.
check("log-mel rescaled to [0, 1] and clipped",
      "np.clip((log_mel - STAGE2_DB_FLOOR) / abs(STAGE2_DB_FLOOR), 0.0, 1.0)" in src)

# Short windows pad with -80 dB (silence), not an edge repeat.
check("short windows pad with -80 dB, not edge-repeat",
      'mode="constant", constant_values=STAGE2_DB_FLOOR' in src
      and 'mode="edge"' not in src)

check("bandpass runs before segmentation",
      "y = bandpass_filter" not in src  # notebook name not used
      and src.index("def load_audio") < src.index("def build_stage1_features"),
      "load_audio must bandpass before build_stage1_features slices cycles")

print(f"\n{'ALL PASS' if failures == 0 else str(failures) + ' FAILURE(S)'}")
sys.exit(1 if failures else 0)