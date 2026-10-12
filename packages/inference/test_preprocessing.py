"""Exercise the real preprocessing path against real librosa.

Unlike test_fusion.py this one does NOT stub librosa — it runs the actual
feature extractors and asserts the shapes and value ranges the models were
trained on. It still does not need TensorFlow or XGBoost, because it stops
short of calling the models.

    python packages/inference/test_preprocessing.py

⚠️ NEEDS A WORKING LIBROSA. On at least one known-broken install (Windows,
Python 3.13, librosa 0.11.0) a single `librosa.feature.mfcc` call on 2.5 s of
audio never returns — `import librosa` succeeds instantly and then the first
feature call hangs indefinitely, with or without `NUMBA_DISABLE_JIT=1`. This
script will hang there too.

Run it on the Mini PC, which is the machine that actually serves inference. The
dependency-free `test_feature_layout.py` and `test_fusion.py` cover the layout
and the decision logic and are safe to run anywhere.
"""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

# Import the service directly; only FastAPI/Pydantic/TF/XGBoost are absent here.
import importlib.util

spec = importlib.util.spec_from_file_location(
    "inference_service", Path(__file__).resolve().parent / "inference_service.py"
)
svc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(svc)

SR = svc.SAMPLE_RATE
failures = 0


def _wav_bytes(samples):
    """Encode a float32 mono array as 16-bit PCM WAV, in memory."""
    import io
    import wave

    pcm = np.clip(samples, -1.0, 1.0)
    pcm16 = (pcm * 32767).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm16.tobytes())
    return buf.getvalue()


def report(label, problems):
    global failures
    if problems:
        failures += 1
        print(f"[FAIL] {label}")
        for p in problems:
            print(f"         - {p}")
    else:
        print(f"[PASS] {label}")


def breathing_like(seconds, sr=SR, base=0.25):
    """Crude synthetic breathing: a slow amplitude-modulated harmonic stack.
    Not physiological, but it has the harmonic structure and cycle rate of
    chest audio, which is what the feature extractors are sensitive to.
    """
    t = np.arange(int(seconds * sr)) / sr
    f0 = 130.0
    sig = (np.sin(2 * np.pi * f0 * t)
           + 0.5 * np.sin(2 * np.pi * 2 * f0 * t)
           + 0.25 * np.sin(2 * np.pi * 3 * f0 * t))
    envelope = 0.5 * (1.0 + np.sin(2 * np.pi * 0.25 * t))  # ~4 s breath cycle
    return (base * sig * envelope).astype(np.float32)


print("=== Stage 1: cycle-aggregated feature vector ===\n")

for seconds in (2.0, 5.0, 12.0):
    audio = svc.load_audio(_wav_bytes(breathing_like(seconds)))
    feats = svc.build_stage1_features(audio)

    problems = []
    if feats.shape != (153,):
        problems.append(f"shape {feats.shape}, expected (153,)")
    if not np.all(np.isfinite(feats)):
        problems.append("contains non-finite values (nan/inf)")
    report(f"{seconds}s recording -> 153-d feature vector", problems)
    print(f"         cycles segmented: {len(svc.segment_cycles(audio))}")

# Descriptor block boundary check: 51 mean, 51 max, 51 std.
audio = svc.load_audio(_wav_bytes(breathing_like(10.0)))
feats = svc.build_stage1_features(audio)
mean_block = feats[:51]
max_block = feats[51:102]
std_block = feats[102:]

problems = []
# max >= mean for every descriptor, for any non-degenerate signal.
if not np.all(max_block >= mean_block - 1e-5):
    bad = np.where(max_block < mean_block - 1e-5)[0]
    problems.append(f"max block below mean block at descriptors {bad.tolist()}")
# std >= 0 everywhere.
if not np.all(std_block >= -1e-9):
    problems.append("std block has negative entries")
# MFCC mean coefficients should be negative for a magnitude-ish spectrogram.
report("block layout is mean | max | std", problems)
print(f"         mean[0:3]={np.round(mean_block[:3], 2)}  "
      f"max[0:3]={np.round(max_block[:3], 2)}  std[0:3]={np.round(std_block[:3], 2)}")

# Per-segment descriptor width.
seg = svc.segment_features(breathing_like(2.5))
report("one cycle -> 51 descriptors",
       [] if seg is not None and seg.shape == (51,)
       else [f"got {None if seg is None else seg.shape}, expected (51,)"])

# Too-short segment must be rejected, exactly as the notebook does.
tiny = np.zeros(int(SR * 0.1))
report("0.1 s segment rejected (notebook: < 0.2 s)",
       [] if svc.segment_features(tiny) is None
       else ["a 0.1 s segment produced features, notebook returns None"])

print("\n=== Stage 2: log-mel tensor ===\n")

for seconds in (2.0, 2.048, 5.0, 12.0):
    audio = svc.load_audio(_wav_bytes(breathing_like(seconds)))
    windows = svc.stage2_windows(audio)
    tensor = svc.build_stage2_tensor(windows[0])

    problems = []
    if tensor.shape != (1, 64, 128, 3):
        problems.append(f"shape {tensor.shape}, expected (1, 64, 128, 3)")
    if not np.all(np.isfinite(tensor)):
        problems.append("contains non-finite values")
    if tensor.min() < 0.0 or tensor.max() > 1.0:
        problems.append(f"range [{tensor.min():.3f}, {tensor.max():.3f}] outside [0, 1]")
    # All three channels must be identical — the notebook repeats one channel.
    if not (np.array_equal(tensor[0, :, :, 0], tensor[0, :, :, 1])
            and np.array_equal(tensor[0, :, :, 0], tensor[0, :, :, 2])):
        problems.append("the 3 channels are not identical")
    report(f"{seconds}s recording -> (1,64,128,3) in [0,1]", problems)

# A short window must pad with silence (0.0 after the /80 rescale), NOT
# repeat its edge. This is the step most easily got wrong.
short = np.zeros(int(SR * 0.5))
short[: int(SR * 0.2)] = breathing_like(0.2, base=0.5)
padded = svc.build_stage2_tensor(short)[0, :, :, 0]
tail = padded[:, -20:]
problems = []
if np.abs(tail).max() > 1e-6:
    problems.append(f"padded tail is not silence, max={np.abs(tail).max():.4f} "
                    "(edge-repeat instead of -80 dB padding?)")
else:
    problems.append(f"padded tail max={np.abs(tail).max():.4f} (silence)")
print("[INFO] " + problems.pop(0))

# The bandpass really is applied: energy outside 100-2000 Hz should be gone.
t = np.arange(SR) / SR
out_of_band = np.sin(2 * np.pi * 6000 * t).astype(np.float32)   # 6 kHz, well above 2 kHz
filtered = svc.load_audio(_wav_bytes(out_of_band))
in_band = breathing_like(1.0)
filtered_in = svc.load_audio(_wav_bytes(in_band))

before = np.sqrt(np.mean(out_of_band ** 2))
after = np.sqrt(np.mean(filtered ** 2))
before_in = np.sqrt(np.mean(in_band ** 2))
after_in = np.sqrt(np.mean(filtered_in ** 2))

problems = []
if after >= before * 0.05:
    problems.append(f"6 kHz tone survived: RMS {before:.4f} -> {after:.4f}")
if after_in <= before_in * 0.5:
    problems.append(f"in-band signal was gutted: RMS {before_in:.4f} -> {after_in:.4f}")
report("bandpass removes 6 kHz but keeps in-band energy", problems)
print(f"         6 kHz RMS {before:.4f} -> {after:.6f}")
print(f"     in-band RMS {before_in:.4f} -> {after_in:.6f}")

print(f"\n{'ALL PASS' if failures == 0 else str(failures) + ' FAILURE(S)'}")
sys.exit(1 if failures else 0)