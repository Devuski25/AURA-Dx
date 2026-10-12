#!/usr/bin/env python3
"""
Inference Service — multi-recording respiratory screening with safety-first fusion.

Pipeline (two stages, per recording):
  Stage 1 "1.5"  XGBoost binary classifier on a 153-d cycle-aggregated acoustic
                 feature vector -> p_healthy. Threshold 0.61.
  Stage 2 "2.5"  EfficientNetB0 binary classifier on a 64x128x3 log-mel tensor
                 -> p_pneumonia (the sigmoid head was trained with
                 y_stage2 = 1 for Pneumonia, 0 for COPD). Threshold 0.47.
                 p_copd = 1 - p_pneumonia.

Each recording is scored independently, then fused with a SAFETY-FIRST rule:
  * a recording that Stage 1 calls Healthy contributes (p_healthy=1.0,
    p_pneumonia=0.0) and is NOT sent to Stage 2;
  * the headline verdict is the MEAN of the per-recording probabilities, which
    smooths out single-site background artifact;
  * BUT if ANY single recording reaches STAGE2_OVERRIDE_THRESHOLD confidence for
    pneumonia, that recording wins regardless of the mean. Lung pathology that is
    audible at one auscultation site can be inaudible at another, so we refuse to
    let averaging bury a high-confidence finding. This trades specificity for
    sensitivity on purpose: a missed pneumonia is far worse than a false alarm.

Preprocessing mirrors `final icbhi nb.ipynb` exactly — see TRAINING REFERENCE
notes on build_stage1_features and build_stage2_tensor for the cell-by-cell
mapping. Every constant below is taken from that notebook; do not "tidy" them
into librosa defaults, the models were fitted on these exact values.
"""
import io
import logging
import os
from pathlib import Path
from typing import List, Optional

import librosa
import numpy as np
from fastapi import Depends, FastAPI, File, HTTPException, Security, UploadFile
from fastapi.responses import JSONResponse
from fastapi.security import APIKeyHeader
from pydantic import BaseModel
from scipy.signal import butter, filtfilt

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

INFERENCE_API_KEY = os.environ.get("INFERENCE_API_KEY", "")
_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


def _verify_api_key(api_key: Optional[str] = Security(_api_key_header)):
    """Require the X-API-Key header only when INFERENCE_API_KEY is configured."""
    if INFERENCE_API_KEY and api_key != INFERENCE_API_KEY:
        raise HTTPException(status_code=403, detail="Invalid or missing API key")


# --------------------------------------------------------------------------
# Model locations
# --------------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
STAGE1_JSON = REPO_ROOT / "model_1_5_export" / "model_1_5_xgboost.json"
STAGE2_KERAS = REPO_ROOT / "model_2_5_export" / "stage2_model_2_5_efficientnet.keras"

# --------------------------------------------------------------------------
# Preprocessing constants.
#
# Every value here is lifted from `final icbhi nb.ipynb`. Two of them are
# deliberate departures from what you would reach for by default:
#
#   * Stage 2 uses n_fft=1024 / hop=256 / fmin=50 / fmax=2000, but Stage 1 uses
#     librosa's DEFAULT n_fft=2048 / hop=512 with mfcc fmin=100 / fmax=2000.
#     The notebook really does use two different analyses for the two stages.
#   * Stage 2's log-mel is rescaled to [0, 1] by (dB + 80) / 80 and clipped.
#     Without that the EfficientNet input range would not match training.
# --------------------------------------------------------------------------
SAMPLE_RATE = 16000

# Stage 1 bandpass, applied to the whole recording before it is split.
BANDPASS_LOW_HZ = 100.0
BANDPASS_HIGH_HZ = 2000.0
BANDPASS_ORDER = 4

# Stage 1 segmentation. The notebook prefers a `.txt` sidecar of annotated
# respiratory-cycle bounds; stethoscope takes have no sidecar, so the fixed
# window below is what always runs in production. 2.5 s window, 1.25 s hop.
STAGE1_WINDOW_SEC = 2.5
STAGE1_HOP_SEC = 1.25
STAGE1_MIN_SEGMENT_SEC = 0.2

# Stage 1 descriptor layout. 51 per cycle x 3 statistics = 153.
N_MFCC = 13
STAGE1_CYCLE_FLOOR = 0.2   # STAGE1_MIN_SEGMENT_SEC, in seconds, as in the notebook
STAGE1_FEATURE_DIM = 153

# Stage 2 log-mel analysis.
STAGE2_N_MELS = 64
STAGE2_N_FFT = 1024
STAGE2_HOP = 256
STAGE2_FMIN = 50.0
STAGE2_FMAX = 2000.0
STAGE2_TARGET_FRAMES = 128
STAGE2_CHANNELS = 3
STAGE2_DB_FLOOR = -80.0    # dB. Also the pad value for short windows.

# Stage 2 scores the recording in ~2.05 s windows (128 frames x 256 hop / 16 kHz)
# with 50% overlap, because that is the length of a single training example
# (one annotated respiratory cycle). The per-window pneumonia probability is
# max-pooled, which is the safety-first choice.
STAGE2_WINDOW_SEC = STAGE2_TARGET_FRAMES * STAGE2_HOP / SAMPLE_RATE   # 2.048
STAGE2_WINDOW_OVERLAP = 0.5
# Backstop on request latency. A 12 s take needs 11 passes, which is fine; an
# accidental 5-minute upload would need ~290. Past this cap the hop widens
# instead, so coverage degrades gracefully rather than stalling the worker.
STAGE2_MAX_WINDOWS = 24

# --------------------------------------------------------------------------
# Decision thresholds
#
# Both come from the notebook's end-to-end evaluation (cell 12), which is the
# only place they are actually applied:
#   p_healthy   >= 0.61 -> Healthy
#   p_pneumonia >= 0.47 -> Pneumonia, else COPD
# --------------------------------------------------------------------------
STAGE1_HEALTHY_THRESHOLD = 0.61
STAGE2_PNEUMONIA_THRESHOLD = 0.47

# Safety-first override. A single recording this confident in pneumonia wins
# regardless of the averaged verdict. Set comfortably above
# STAGE2_PNEUMONIA_THRESHOLD so the override only fires on a genuinely
# high-confidence finding rather than on borderline noise.
STAGE2_OVERRIDE_THRESHOLD = 0.60

MAX_RECORDINGS = 5
MIN_RECORDINGS = 3

MODEL_VERSION = "2.5.0-multi"

# Populated at startup
_stage1_model = None
_stage2_model = None


def load_models():
    """Load both stages. Raises on failure so the service fails fast rather
    than serving 500s for every request."""
    global _stage1_model, _stage2_model
    import xgboost as xgb

    logger.info("Loading Stage 1 (1.5 XGBoost) from %s", STAGE1_JSON)
    booster = xgb.Booster()
    booster.load_model(str(STAGE1_JSON))
    _stage1_model = booster

    logger.info("Loading Stage 2 (2.5 EfficientNetB0) from %s", STAGE2_KERAS)
    import tensorflow as tf  # imported late: heavy, and only needed at startup

    _stage2_model = tf.keras.models.load_model(str(STAGE2_KERAS))

    logger.info("Models loaded. stage1 features=%d", STAGE1_FEATURE_DIM)


# --------------------------------------------------------------------------
# Audio loading and shared preprocessing
# --------------------------------------------------------------------------
def load_audio(audio_bytes: bytes) -> np.ndarray:
    """Decode to mono 16 kHz and apply the shared bandpass."""
    audio, sr = librosa.load(io.BytesIO(audio_bytes), sr=SAMPLE_RATE, mono=True)
    if audio.size == 0:
        raise ValueError("Decoded audio is empty")

    nyquist = 0.5 * sr
    low = BANDPASS_LOW_HZ / nyquist
    high = min(BANDPASS_HIGH_HZ / nyquist, 0.99)
    if low > 0 and low < high:
        b, a = butter(BANDPASS_ORDER, [low, high], btype="band")
        # filtfilt needs a minimum signal length; skip on very short clips
        if audio.size > 3 * max(len(a), len(b)):
            audio = filtfilt(b, a, audio)
    return audio


def peak_normalise(audio: np.ndarray) -> np.ndarray:
    """Scale to unit peak so absolute recording gain cannot move the features."""
    peak = np.max(np.abs(audio))
    if peak > 0:
        return audio / peak
    return audio


def segment_cycles(audio: np.ndarray) -> List[np.ndarray]:
    """Split a recording into cycle-sized segments.

    TRAINING REFERENCE — notebook cell 6 / cell 12, `extract_cycle_aggregated_features`:
    the notebook reads annotated respiratory-cycle bounds from a `.txt` sidecar
    next to the wav, and falls back to fixed 2.5 s windows at a 1.25 s hop when
    there is no sidecar.

    Stethoscope takes recorded by the app never have a sidecar, so the fixed
    window is the only path that runs in production. The sidecar branch is kept
    so offline evaluation against the ICBHI dataset reproduces notebook numbers.
    """
    win_samples = int(STAGE1_WINDOW_SEC * SAMPLE_RATE)
    hop_samples = int(STAGE1_HOP_SEC * SAMPLE_RATE)
    min_samples = int(STAGE1_MIN_SEGMENT_SEC * SAMPLE_RATE)

    segments: List[np.ndarray] = []
    for start in range(0, max(len(audio) - win_samples, 1), hop_samples):
        segments.append(audio[start:start + win_samples])

    # A recording shorter than one window still has to produce a usable vector.
    if not segments or all(s.size < min_samples for s in segments):
        segments = [audio]

    return segments


def segment_features(y_segment: np.ndarray) -> np.ndarray:
    """One cycle -> 51 descriptors.

    TRAINING REFERENCE — notebook cell 6 / cell 12, `extract_segment_features`.
    The 51 slots, in order:

        0-12   MFCC mean over time          (n_mfcc=13, fmin=100, fmax=2000)
        13-25  delta-MFCC mean              (width per the rule below)
        26-38  delta-delta-MFCC mean
        39     spectral centroid mean
        40     spectral bandwidth mean
        41-47  spectral contrast mean       (fmin=100, default fmax -> 7 bands)
        48     spectral flatness mean
        49     zero-crossing rate mean
        50     RMS mean

    Note this deliberately uses librosa's DEFAULT n_fft=2048 / hop_length=512,
    because the notebook never overrides them for these descriptors. Stage 2
    uses different values; do not unify them.

    Returns None for a segment shorter than 0.2 s, exactly as the notebook does.
    """
    if len(y_segment) < int(SAMPLE_RATE * STAGE1_CYCLE_FLOOR):
        return None

    y_segment = peak_normalise(y_segment)

    mfcc = librosa.feature.mfcc(
        y=y_segment, sr=SAMPLE_RATE, n_mfcc=N_MFCC,
        fmin=BANDPASS_LOW_HZ, fmax=BANDPASS_HIGH_HZ,
    )

    # The notebook narrows the delta width for short segments and zeroes the
    # deltas entirely when the window is too narrow to support them.
    n_frames = mfcc.shape[1]
    width = 9 if n_frames >= 9 else (n_frames if n_frames % 2 != 0 else n_frames - 1)
    if width >= 3:
        mfcc_delta = librosa.feature.delta(mfcc, width=width)
        mfcc_delta2 = librosa.feature.delta(mfcc, order=2, width=width)
    else:
        mfcc_delta = np.zeros_like(mfcc)
        mfcc_delta2 = np.zeros_like(mfcc)

    spec_cent = librosa.feature.spectral_centroid(y=y_segment, sr=SAMPLE_RATE)
    spec_bw = librosa.feature.spectral_bandwidth(y=y_segment, sr=SAMPLE_RATE)
    spec_contrast = librosa.feature.spectral_contrast(
        y=y_segment, sr=SAMPLE_RATE, fmin=BANDPASS_LOW_HZ
    )
    spec_flat = librosa.feature.spectral_flatness(y=y_segment)
    zcr = librosa.feature.zero_crossing_rate(y=y_segment)
    rms = librosa.feature.rms(y=y_segment)

    feats: List[float] = []
    for mat in [mfcc, mfcc_delta, mfcc_delta2,
                spec_cent, spec_bw, spec_contrast, spec_flat, zcr, rms]:
        feats.extend(np.mean(mat, axis=1))
    return np.array(feats, dtype=np.float32)


def build_stage1_features(audio: np.ndarray) -> np.ndarray:
    """Build the 153-dim cycle-aggregated acoustic feature vector.

    TRAINING REFERENCE — notebook cell 6 / cell 12, `extract_cycle_aggregated_features`:
        153 = 51 descriptors x 3 statistics, concatenated as
        ``hstack([mean, max, std])``

    That ORDER IS LOAD-BEARING. XGBoost indexes features positionally, so
    swapping max and std would feed every tree scrambled values and the model
    would still return confident nonsense:

        indices   0- 50  the 51 descriptors, MEAN over cycles
        indices  51-101  the 51 descriptors, MAX  over cycles
        indices 102-152  the 51 descriptors, STD  over cycles

    `audio` must already be bandpassed — the notebook filters the whole
    recording once and only then slices it into cycles.
    """
    cycles = segment_cycles(audio)

    cycle_feats = []
    for cycle in cycles:
        feat = segment_features(cycle)
        if feat is not None:
            cycle_feats.append(feat)

    if not cycle_feats:
        raise ValueError(
            "recording is too short to produce a feature vector "
            f"(needs at least {STAGE1_MIN_SEGMENT_SEC}s of usable audio)"
        )

    cycle_mat = np.array(cycle_feats)
    if cycle_mat.shape[1] != 51:
        raise ValueError(
            f"cycle descriptor block is {cycle_mat.shape[1]} wide, expected 51"
        )

    features = np.hstack([
        np.mean(cycle_mat, axis=0),
        np.max(cycle_mat, axis=0),
        np.std(cycle_mat, axis=0),
    ]).astype(np.float32)

    if features.size != STAGE1_FEATURE_DIM:
        raise ValueError(
            f"Stage 1 feature vector is {features.size} dims, expected {STAGE1_FEATURE_DIM}"
        )
    return features

    features = np.concatenate([
        matrix.mean(axis=0),
        matrix.std(axis=0),
        matrix.max(axis=0),
    ]).astype(np.float32)

    if features.size != STAGE1_FEATURE_DIM:
        raise ValueError(
            f"Stage 1 feature vector is {features.size} dims, expected {STAGE1_FEATURE_DIM}"
        )
    return features


def build_stage2_tensor(y_segment: np.ndarray) -> np.ndarray:
    """One cycle -> a (1, 64, 128, 3) log-mel batch for Stage 2.

    TRAINING REFERENCE — notebook cell 5, `extract_clean_mel_segment`, which is
    what the EfficientNet was actually TRAINED on:

        melspectrogram(n_fft=1024, hop_length=256, n_mels=64, fmin=50, fmax=2000)
        power_to_db(ref=np.max)                  -> [-80 dB, 0 dB]
        pad/truncate to exactly 128 frames, padding with -80 dB
        (log_mel + 80) / 80, clipped to [0, 1]
        repeat to 3 channels

    Two of these steps are easy to omit and both silently degrade accuracy:

      * The /80 rescale. Raw dB values run -80..0, which is a very different
        input range from the [0, 1] the backbone was fitted on.
      * Padding value. Short cycles pad with -80 dB, which maps to exactly 0.0
        after the rescale — silence, not an edge-repeat of the last frame.

    The Resizing(224, 224) layer lives INSIDE the model, so this returns the raw
    64x128x3 tensor and must not be resized here.
    """
    y_segment = peak_normalise(y_segment)

    mel = librosa.feature.melspectrogram(
        y=y_segment, sr=SAMPLE_RATE, n_fft=STAGE2_N_FFT, hop_length=STAGE2_HOP,
        n_mels=STAGE2_N_MELS, fmin=STAGE2_FMIN, fmax=STAGE2_FMAX,
    )
    log_mel = librosa.power_to_db(mel, ref=np.max)

    n_frames = log_mel.shape[1]
    if n_frames < STAGE2_TARGET_FRAMES:
        log_mel = np.pad(
            log_mel,
            ((0, 0), (0, STAGE2_TARGET_FRAMES - n_frames)),
            mode="constant", constant_values=STAGE2_DB_FLOOR,
        )
    else:
        log_mel = log_mel[:, :STAGE2_TARGET_FRAMES]

    log_mel = np.clip((log_mel - STAGE2_DB_FLOOR) / abs(STAGE2_DB_FLOOR), 0.0, 1.0)
    log_mel = np.repeat(log_mel[:, :, np.newaxis], STAGE2_CHANNELS, axis=2)

    return log_mel.astype(np.float32)[np.newaxis, ...]


def stage2_windows(audio: np.ndarray) -> List[np.ndarray]:
    """Cut a recording into overlapping Stage 2 windows.

    Each training example was one annotated respiratory cycle resampled to
    exactly 128 mel frames = 2.048 s. Feeding the model a whole 10 s take in one
    go would put a distribution it never saw into EfficientNetB0, so the take is
    cut to the training length with 50% overlap (the same ratio the notebook
    used for its training stride, 375/188).
    """
    win = int(STAGE2_WINDOW_SEC * SAMPLE_RATE)
    hop = max(int(win * (1.0 - STAGE2_WINDOW_OVERLAP)), 1)

    # Widen the hop on very long takes so one upload cannot pin the worker
    # through hundreds of EfficientNet passes.
    if len(audio) > win:
        max_start = len(audio) - win
        needed = max_start // hop + 1
        if needed > STAGE2_MAX_WINDOWS:
            hop = max(max_start // (STAGE2_MAX_WINDOWS - 1), 1)

    windows = []
    start = 0
    while start < len(audio):
        windows.append(audio[start:start + win])
        if start + win >= len(audio):
            break
        start += hop

    return windows or [audio]


# --------------------------------------------------------------------------
# Per-stage inference
# --------------------------------------------------------------------------
def stage1_healthy_probability(audio: np.ndarray) -> float:
    """Return p_healthy for one recording.

    The XGBoost stage was fitted with `y_s1 = 1` for Healthy, and the notebook
    reads `predict_proba(...)[:, 1]` as the Healthy probability.
    """
    features = build_stage1_features(audio)
    probs = _stage1_model.inplace_predict(features.reshape(1, STAGE1_FEATURE_DIM))
    return float(np.asarray(probs).ravel()[0])


def stage2_pneumonia_probability(audio: np.ndarray) -> float:
    """Return p_pneumonia for one recording, max-pooled over its windows.

    The Stage 2 head is a single sigmoid unit trained with
    `y_stage2 = 1` for Pneumonia and `0` for COPD, so the output IS the
    pneumonia probability; p_copd = 1 - p_pneumonia.

    Taking the max across windows rather than the mean is deliberate: pneumonia
    may be audible in only one part of a take, and averaging would let the quiet
    stretches dilute it.
    """
    windows = stage2_windows(audio)
    batch = np.concatenate([build_stage2_tensor(w) for w in windows], axis=0)
    outputs = _stage2_model.predict(batch, verbose=0)
    return float(np.max(np.asarray(outputs).ravel()))


def score_single_clip(audio: np.ndarray, index: int) -> dict:
    """Run the sequential cascade over one recording and return raw scores.

    Stage 1 terminates the clip early when it is Healthy; such a clip is pinned
    to (p_healthy = 1.0, p_pneumonia = 0.0) and never reaches Stage 2.
    """
    p_healthy = stage1_healthy_probability(audio)

    if p_healthy >= STAGE1_HEALTHY_THRESHOLD:
        return {
            "index": index,
            "duration_sec": round(len(audio) / SAMPLE_RATE, 2),
            "stage1_healthy_prob": round(p_healthy, 4),
            "stage1_routed_to_stage2": False,
            "stage2_pneumonia_prob": None,
            "healthy_prob": 1.0,
            "pneumonia_prob": 0.0,
            "copd_prob": 0.0,
            "clip_label": "Healthy",
        }

    p_pneumonia = stage2_pneumonia_probability(audio)
    p_copd = 1.0 - p_pneumonia
    label = "Pneumonia" if p_pneumonia >= STAGE2_PNEUMONIA_THRESHOLD else "COPD"

    return {
        "index": index,
        "duration_sec": round(len(audio) / SAMPLE_RATE, 2),
        "stage1_healthy_prob": round(p_healthy, 4),
        "stage1_routed_to_stage2": True,
        "stage2_pneumonia_prob": round(p_pneumonia, 4),
        "healthy_prob": 0.0,
        "pneumonia_prob": round(p_pneumonia, 4),
        "copd_prob": round(p_copd, 4),
        "clip_label": label,
    }


# --------------------------------------------------------------------------
# Cross-recording fusion
# --------------------------------------------------------------------------
def fuse_clips(clip_results: List[dict]) -> dict:
    """Average across recordings, then apply the safety-first pathology override.

    Decision order matters and is deliberate:

    1. Safety override first. A single recording at or above
       STAGE2_OVERRIDE_THRESHOLD pneumonia confidence wins outright, *before*
       the Healthy check — otherwise four healthy-looking takes would bury the
       one site where pathology is actually audible.
    2. Otherwise the mean decides. Healthy if the fused healthy probability
       clears the Stage 1 threshold, otherwise the louder of the two
       pathological classes.

    Pneumonia is the acute class and COPD the chronic one, so preferring
    Pneumonia whenever it is in the lead is the safety-first tiebreak.
    """
    n = len(clip_results)
    mean_healthy = float(np.mean([c["healthy_prob"] for c in clip_results]))
    mean_pneumonia = float(np.mean([c["pneumonia_prob"] for c in clip_results]))
    mean_copd = float(np.mean([c["copd_prob"] for c in clip_results]))

    override_clips = [
        c for c in clip_results
        if c["clip_label"] == "Pneumonia" and c["pneumonia_prob"] >= STAGE2_OVERRIDE_THRESHOLD
    ]

    triggered_by = None
    override = None

    if override_clips:
        override = "single_clip_high_confidence_pneumonia"
        triggered_by = override_clips[0]["index"]
        label = "Pneumonia"
        confidence = max(c["pneumonia_prob"] for c in override_clips)
    elif mean_healthy >= STAGE1_HEALTHY_THRESHOLD:
        label = "Healthy"
        confidence = mean_healthy
    elif mean_pneumonia > mean_copd:
        label = "Pneumonia"
        confidence = mean_pneumonia
    else:
        label = "COPD"
        confidence = mean_copd

    probabilities = {
        "Healthy": round(mean_healthy, 4),
        "Pneumonia": round(mean_pneumonia, 4),
        "COPD": round(mean_copd, 4),
    }
    # Renormalise so the fused vector reads as a distribution. Renormalising
    # never changes the reported label — that was already decided above.
    total = sum(probabilities.values())
    if total > 0:
        probabilities = {k: round(v / total, 4) for k, v in probabilities.items()}

    return {
        "label": label,
        "confidence": round(float(confidence), 4),
        "probabilities": probabilities,
        "fusion": {
            "method": "mean_then_safety_override",
            "recordings_fused": n,
            "recordings_flagged_pathological": sum(
                1 for c in clip_results if c["stage1_routed_to_stage2"]
            ),
            "override_applied": override,
            "override_triggered_by_clip": triggered_by,
            "override_threshold": STAGE2_OVERRIDE_THRESHOLD,
            "stage1_healthy_threshold": STAGE1_HEALTHY_THRESHOLD,
            "stage2_pneumonia_threshold": STAGE2_PNEUMONIA_THRESHOLD,
        },
    }


# --------------------------------------------------------------------------
# HTTP surface
# --------------------------------------------------------------------------
app = FastAPI(title="AURA-Dx Inference Service", version=MODEL_VERSION)


@app.on_event("startup")
async def startup_event():
    load_models()


class ClipScore(BaseModel):
    index: int
    duration_sec: float
    stage1_healthy_prob: float
    stage1_routed_to_stage2: bool
    stage2_pneumonia_prob: Optional[float]
    healthy_prob: float
    pneumonia_prob: float
    copd_prob: float
    clip_label: str


class FusionInfo(BaseModel):
    method: str
    recordings_fused: int
    recordings_flagged_pathological: int
    override_applied: Optional[str]
    override_triggered_by_clip: Optional[int]
    override_threshold: float
    stage1_healthy_threshold: float
    stage2_pneumonia_threshold: float


class InferenceResponse(BaseModel):
    model_version: str
    recordings_received: int
    per_clip: List[ClipScore]
    respiratory_result: dict
    fusion: FusionInfo
    clinical_note: str


@app.post("/api/inference", response_model=InferenceResponse)
async def inference(audios: List[UploadFile] = File(...), _=Depends(_verify_api_key)):
    """Score a batch of 3-5 auscultation recordings and return one fused verdict."""
    if not audios:
        raise HTTPException(status_code=400, detail="No recordings supplied")
    if len(audios) > MAX_RECORDINGS:
        raise HTTPException(
            status_code=400,
            detail=f"Too many recordings: {len(audios)}. Maximum is {MAX_RECORDINGS}.",
        )

    clip_results = []
    for index, upload in enumerate(audios):
        if not upload.filename or not upload.filename.lower().endswith(".wav"):
            raise HTTPException(
                status_code=400,
                detail=f"Recording {index + 1} ({upload.filename}) is not a .wav file",
            )
        try:
            audio = load_audio(await upload.read())
            clip_results.append(score_single_clip(audio, index))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"Recording {index + 1}: {exc}")
        except Exception as exc:
            logger.exception("Inference failed on recording %s", index)
            raise HTTPException(status_code=500, detail=f"Recording {index + 1}: {exc}")

    fused = fuse_clips(clip_results)
    logger.info(
        "Fused %d recordings -> %s (%.3f), override=%s",
        len(clip_results), fused["label"], fused["confidence"],
        fused["fusion"]["override_applied"],
    )

    return JSONResponse(content={
        "model_version": MODEL_VERSION,
        "recordings_received": len(clip_results),
        "per_clip": clip_results,
        "respiratory_result": fused,
        "fusion": fused["fusion"],
        "clinical_note": (
            "Screening support only, not a diagnosis. A single-recording pathology "
            "flag overrides the averaged verdict by design (safety-first)."
        ),
    })


@app.get("/health")
async def health():
    return {
        "status": "healthy" if (_stage1_model and _stage2_model) else "degraded",
        "model_version": MODEL_VERSION,
        "models_loaded": bool(_stage1_model and _stage2_model),
        "min_recordings": MIN_RECORDINGS,
        "max_recordings": MAX_RECORDINGS,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
