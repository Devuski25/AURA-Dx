"""
audio_utils.py — CoughPH Dual-Tier DSP Pipeline
════════════════════════════════════════════════════════════════════
Shared preprocessing used by both the TB Gatekeeper (Tier 1) and the
Respiratory Classifier (Tier 2). Both tiers are derived from the SAME
filtered signal buffer so they never drift out of sync with one another.

Pipeline:
    1. Load audio -> force mono, resample to 16,000 Hz
    2. 5th-order Butterworth low-pass filter, cutoff = 3,000 Hz (scipy, zero-phase)
    3. Peak-centered slice extraction (edge-padded if the window runs off the buffer)
         Tier 1 -> 0.34s window  (TB Gatekeeper)
         Tier 2 -> 2.0s window   (Respiratory Classifier)
    4. Log-Mel Spectrogram -> normalized -> resized -> replicated to 3 channels
       -> ImageNet-style channel normalization -> ready for ResNet18 .eval() inference
"""

import numpy as np
import soundfile as sf
import torch
import torchaudio.transforms as T
import torchaudio.functional as AF
from scipy import signal as scipy_signal

# ── DSP constants ──────────────────────────────────────────────────
TARGET_SR = 16000
LOWPASS_CUTOFF_HZ = 3000
FILTER_ORDER = 5

TIER1_DURATION_SEC = 0.34   # TB Gatekeeper window
TIER2_DURATION_SEC = 2.0    # Respiratory Classifier window

# ── Log-Mel spectrogram constants ──────────────────────────────────
N_FFT = 1024
HOP_LENGTH = 256
N_MELS = 64

# ── ResNet18 input constants ───────────────────────────────────────
# NOTE: the supplied checkpoints only contain standard torchvision
# resnet18 layers (conv1..fc), so no custom normalization stats were
# recoverable from the .pth files themselves. We fall back to the
# canonical ImageNet mean/std, which is the standard choice for a
# 3-channel ResNet18 backbone. If your training script used different
# stats, swap them in below and re-export the weights accordingly.
IMG_SIZE = 224
_IMAGENET_MEAN = torch.tensor([0.485, 0.456, 0.406]).view(3, 1, 1)
_IMAGENET_STD = torch.tensor([0.229, 0.224, 0.225]).view(3, 1, 1)

# Reusable transform objects (stateless, safe to share across requests)
_mel_transform = T.MelSpectrogram(
    sample_rate=TARGET_SR,
    n_fft=N_FFT,
    hop_length=HOP_LENGTH,
    n_mels=N_MELS,
)
_db_transform = T.AmplitudeToDB(stype="power", top_db=80)


# ════════════════════════════════════════════════════════════════
# 1. Ingestion — force 16kHz mono
# ════════════════════════════════════════════════════════════════
def load_audio_mono_16k(filepath: str) -> np.ndarray:
    """Loads any audio file supported by libsndfile (wav/flac/ogg natively;
    most browser-recorded webm/mp4 containers land here fine on Linux
    builds that link ffmpeg-backed libsndfile) and returns a 1-D float32
    numpy array at TARGET_SR, collapsed to mono.

    Loading is done via `soundfile` rather than `torchaudio.load` because
    recent torchaudio releases require an additional `torchcodec` backend
    for decoding — soundfile has a stable, dependency-light API that
    isn't subject to that churn.
    """
    data, sr = sf.read(filepath, dtype="float32", always_2d=True)  # [samples, channels]

    if data.size == 0:
        raise ValueError("Decoded audio buffer is empty.")

    mono = np.mean(data, axis=1).astype(np.float32)  # -> [samples]

    if sr != TARGET_SR:
        waveform = torch.from_numpy(mono).unsqueeze(0)  # [1, samples]
        waveform = AF.resample(waveform, orig_freq=sr, new_freq=TARGET_SR)
        mono = waveform.squeeze(0).numpy().astype(np.float32)

    return mono


# ════════════════════════════════════════════════════════════════
# 2. 5th-order Butterworth low-pass @ 3000 Hz (zero-phase via filtfilt)
# ════════════════════════════════════════════════════════════════
def butterworth_lowpass(
    signal_1d: np.ndarray,
    cutoff_hz: float = LOWPASS_CUTOFF_HZ,
    sr: int = TARGET_SR,
    order: int = FILTER_ORDER,
) -> np.ndarray:
    nyquist = 0.5 * sr
    normal_cutoff = cutoff_hz / nyquist
    b, a = scipy_signal.butter(order, normal_cutoff, btype="low", analog=False)
    # filtfilt -> zero-phase (no time-domain shift, critical for peak-centering downstream)
    filtered = scipy_signal.filtfilt(b, a, signal_1d)
    return filtered.astype(np.float32)


# ════════════════════════════════════════════════════════════════
# 3. Peak-centered slice extraction (with graceful edge padding)
# ════════════════════════════════════════════════════════════════
def peak_centered_window(
    signal_1d: np.ndarray,
    window_sec: float,
    sr: int = TARGET_SR,
) -> np.ndarray:
    """Finds the absolute-maximum-amplitude sample and centers a fixed-length
    window on it. If the window would run off either edge of the buffer,
    the missing samples are zero-padded rather than dropped, so the output
    length is always exactly `window_sec * sr` samples."""
    window_samples = int(round(window_sec * sr))

    if signal_1d.size == 0:
        return np.zeros(window_samples, dtype=np.float32)

    peak_idx = int(np.argmax(np.abs(signal_1d)))
    half = window_samples // 2

    start = peak_idx - half
    end = start + window_samples

    pad_left = max(0, -start)
    pad_right = max(0, end - signal_1d.size)

    start_clamped = max(0, start)
    end_clamped = min(signal_1d.size, end)

    sliced = signal_1d[start_clamped:end_clamped]

    if pad_left > 0 or pad_right > 0:
        sliced = np.pad(sliced, (pad_left, pad_right), mode="constant")

    # Final safety net in case of off-by-one rounding
    if sliced.size > window_samples:
        sliced = sliced[:window_samples]
    elif sliced.size < window_samples:
        sliced = np.pad(sliced, (0, window_samples - sliced.size), mode="constant")

    return sliced.astype(np.float32)


# ════════════════════════════════════════════════════════════════
# 4. Log-Mel Spectrogram -> normalized 3-channel ResNet18 tensor
# ════════════════════════════════════════════════════════════════
def to_resnet_tensor(window_1d: np.ndarray) -> torch.Tensor:
    """Converts a 1-D waveform window into a [1, 3, IMG_SIZE, IMG_SIZE]
    tensor ready to be passed directly into a ResNet18 forward pass."""
    wav_tensor = torch.from_numpy(window_1d).unsqueeze(0)  # [1, samples]

    mel = _mel_transform(wav_tensor)        # [1, n_mels, time]
    log_mel = _db_transform(mel)             # [1, n_mels, time] (in dB)

    # Per-sample zero-mean / unit-variance normalization
    mean = log_mel.mean()
    std = log_mel.std()
    if std < 1e-6:
        std = torch.tensor(1e-6)
    log_mel = (log_mel - mean) / std

    # Resize (n_mels x time) -> (IMG_SIZE x IMG_SIZE) to match ResNet18 input dims
    log_mel = log_mel.unsqueeze(0)  # [1, 1, n_mels, time]
    log_mel = torch.nn.functional.interpolate(
        log_mel, size=(IMG_SIZE, IMG_SIZE), mode="bilinear", align_corners=False
    )
    log_mel = log_mel.squeeze(0)  # [1, IMG_SIZE, IMG_SIZE]

    # Replicate single channel -> 3 channels
    rgb = log_mel.repeat(3, 1, 1)  # [3, IMG_SIZE, IMG_SIZE]

    # Rescale to [0, 1] before applying ImageNet-style channel normalization
    rgb_min, rgb_max = rgb.min(), rgb.max()
    if (rgb_max - rgb_min) < 1e-6:
        rgb = torch.zeros_like(rgb)
    else:
        rgb = (rgb - rgb_min) / (rgb_max - rgb_min)

    rgb = (rgb - _IMAGENET_MEAN) / _IMAGENET_STD

    return rgb.unsqueeze(0)  # [1, 3, IMG_SIZE, IMG_SIZE] — batch-ready


# ════════════════════════════════════════════════════════════════
# Public entry point — used directly by app.py
# ════════════════════════════════════════════════════════════════
def extract_dual_tier_tensors(filepath: str):
    """Runs the full shared pipeline once and returns both tier tensors.

    Returns:
        (tier1_tensor, tier2_tensor) — each a [1, 3, IMG_SIZE, IMG_SIZE] torch.Tensor
    """
    mono_16k = load_audio_mono_16k(filepath)
    filtered = butterworth_lowpass(mono_16k)

    tier1_window = peak_centered_window(filtered, TIER1_DURATION_SEC)
    tier2_window = peak_centered_window(filtered, TIER2_DURATION_SEC)

    tier1_tensor = to_resnet_tensor(tier1_window)
    tier2_tensor = to_resnet_tensor(tier2_window)

    return tier1_tensor, tier2_tensor
