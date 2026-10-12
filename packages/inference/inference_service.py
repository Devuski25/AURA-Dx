#!/usr/bin/env python3
"""
Inference Service — multi-recording respiratory screening with safety-first fusion.

Pipeline (two stages, per recording):
  Stage 1 "1.5"  XGBoost binary classifier on a 153-d aggregated acoustic feature
                 vector -> p_healthy. Threshold 0.61 (see STAGE1_HEALTHY_THRESHOLD).
  Stage 2 "2.5"  EfficientNetB0 binary classifier on a 64x128x3 log-mel tensor
                 -> p_copd (sigmoid output unit). Threshold 0.47 (see STAGE2_COPD_THRESHOLD).

Each recording is scored independently, then fused with a SAFETY-FIRST rule:
  * a clip that Stage 1 calls Healthy contributes (p_healthy=1.0, p_pneumonia=0.0)
    and is NOT sent to Stage 2;
  * the headline verdict is the MEAN of the per-clip probabilities, which smooths
    out single-site background artifact;
  * BUT if ANY single clip reaches STAGE2_OVERRIDE_THRESHOLD confidence for
    pathology, that clip wins regardless of the mean. Lung pathology that is
    audible at one auscultation site can be inaudible at another, so we refuse to
    let averaging bury a high-confidence finding. This trades specificity for
    sensitivity on purpose: a missed pneumonia is far worse than a false alarm.

Preprocessing (shared, must match training):
  - librosa.load(sr=16000, mono=True)
  - 4th-order Butterworth bandpass, 100-2000 Hz, applied forward+backward
    (filtfilt) so the signal has no phase distortion
  - peak-amplitude normalisation before feature extraction
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
# Preprocessing constants (must match training exactly)
# --------------------------------------------------------------------------
SAMPLE_RATE = 16000
BANDPASS_LOW_HZ = 100.0
BANDPASS_HIGH_HZ = 2000.0
BANDPASS_ORDER = 4

N_MELS = 64
N_FFT = 1024
HOP_LENGTH = 256
# Stage 2 takes the raw 64x128x3 tensor; the EfficientNetB0 backbone resizes
# internally to 224x224, so we must NOT resize here.
STAGE2_MEL_ROWS = 64
STAGE2_MEL_COLS = 128
STAGE2_CHANNELS = 3

# Stage 1 feature layout
N_MFCC = 13
STAGE1_FEATURE_DIM = 153

# --------------------------------------------------------------------------
# Decision thresholds (from the model performance reports)
# --------------------------------------------------------------------------
STAGE1_HEALTHY_THRESHOLD = 0.61   # p_healthy >= 0.61 -> Healthy for that clip
STAGE2_COPD_THRESHOLD = 0.47      # p_copd  >= 0.47 -> COPD, else Pneumonia

# Safety-first override. A single clip this confident in pathology overrides the
# averaged verdict. Set comfortably above STAGE2_COPD_THRESHOLD so the override
# only fires on a genuinely high-confidence finding, not on borderline noise.
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
    if peak > 1e-8:
        return audio / peak
    return audio


def segment_cycles(audio: np.ndarray, min_cycle_sec: float = 0.25,
                   max_cycle_sec: float = 8.0) -> List[np.ndarray]:
    """Split a recording into respiratory-cycle-sized segments.

    Onset-strength peaks mark inhalation/exhalation boundaries. If detection
    finds nothing usable we fall back to fixed windows so a steady or noisy
    recording still produces a usable feature vector instead of failing.
    """
    min_len = int(min_cycle_sec * SAMPLE_RATE)
    max_len = int(max_cycle_sec * SAMPLE_RATE)

    segments: List[np.ndarray] = []
    try:
        onset = librosa.onset.onset_strength(y=audio, sr=SAMPLE_RATE, hop_length=HOP_LENGTH)
        peaks = librosa.util.peak_pick(
            onset, pre_max=3, post_max=3, pre_avg=6, post_avg=6, delta=0.5, wait=8
        )
        times = librosa.frames_to_time(peaks, sr=SAMPLE_RATE, hop_length=HOP_LENGTH)
        bounds = [0.0] + [t for t in times if t > 0] + [len(audio) / SAMPLE_RATE]
        for start, end in zip(bounds[:-1], bounds[1:]):
            seg = audio[int(start * SAMPLE_RATE):int(end * SAMPLE_RATE)]
            if min_len <= seg.size <= max_len:
                segments.append(seg)
    except Exception as exc:  # onset detection is best-effort
        logger.debug("Cycle segmentation fell back to fixed windows: %s", exc)

    if not segments:
        step = max_len
        for start in range(0, max(len(audio), 1), step):
            seg = audio[start:start + step]
            if seg.size >= min_len:
                segments.append(seg)
    return segments


def build_stage1_features(audio: np.ndarray) -> np.ndarray:
    """Build the 153-dim aggregated acoustic feature vector.

    Layout (51 base descriptors x 3 cycle statistics = 153):
        indices   0- 12  MFCC mean over cycles
        indices  13- 25  delta-MFCC mean
        indices  26- 38  delta-delta-MFCC mean
        indices  39- 50  spectral descriptors (contrast x7, centroid,
                          bandwidth, rolloff, flatness, zcr)
        indices  51-103 base descriptors, std over cycles
        indices 104-156 base descriptors, max over cycles

    NOTE: the per-descriptor ordering inside each 51-slot block must match the
    training feature builder exactly. This is the single assumption in the whole
    pipeline that cannot be verified from the model file alone; it must be
    checked against the training notebook before results are trusted.
    """
    audio = peak_normalise(audio)
    cycles = segment_cycles(audio)
    if not cycles:
        cycles = [audio]

    per_cycle = []
    for cycle in cycles:
        mfcc = librosa.feature.mfcc(y=cycle, sr=SAMPLE_RATE, n_mfcc=N_MFCC,
                                    n_fft=N_FFT, hop_length=HOP_LENGTH)
        delta = librosa.feature.delta(mfcc)
        delta2 = librosa.feature.delta(mfcc, order=2)

        contrast = librosa.feature.spectral_contrast(
            y=cycle, sr=SAMPLE_RATE, n_fft=N_FFT, hop_length=HOP_LENGTH
        )
        centroid = librosa.feature.spectral_centroid(
            y=cycle, sr=SAMPLE_RATE, n_fft=N_FFT, hop_length=HOP_LENGTH
        )
        bandwidth = librosa.feature.spectral_bandwidth(
            y=cycle, sr=SAMPLE_RATE, n_fft=N_FFT, hop_length=HOP_LENGTH
        )
        rolloff = librosa.feature.spectral_rolloff(
            y=cycle, sr=SAMPLE_RATE, n_fft=N_FFT, hop_length=HOP_LENGTH, roll_percent=0.85
        )
        flatness = librosa.feature.spectral_flatness(
            y=cycle, n_fft=N_FFT, hop_length=HOP_LENGTH
        )
        zcr = librosa.feature.zero_crossing_rate(
            cycle, frame_length=N_FFT, hop_length=HOP_LENGTH
        )

        spectral = np.vstack([
            contrast,
            centroid, bandwidth, rolloff, flatness, zcr,
        ])
        # contrast is (7, T); the scalars are (1, T) -> 7 + 5 = 12 rows.
        spectral = spectral.reshape(spectral.shape[0], -1).mean(axis=1)
        if spectral.size < 12:
            spectral = np.pad(spectral, (0, 12 - spectral.size))

        base = np.concatenate([
            mfcc.mean(axis=1),          # 13
            delta.mean(axis=1),         # 13
            delta2.mean(axis=1),        # 13
            spectral[:12],              # 12
        ])
        per_cycle.append(base[:51])

    if not per_cycle:
        per_cycle = [np.zeros(51)]
    matrix = np.vstack(per_cycle)

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


def build_stage2_tensor(audio: np.ndarray) -> np.ndarray:
    """Build the (64, 128, 3) log-mel tensor for Stage 2.

    power_to_db only — no manual min-max normalisation, matching the Stage 2
    training pipeline. The backbone resizes to 224x224 internally.
    """
    audio = peak_normalise(audio)
    mel = librosa.feature.melspectrogram(
        y=audio, sr=SAMPLE_RATE, n_mels=STAGE2_MEL_ROWS,
        n_fft=N_FFT, hop_length=HOP_LENGTH, power=2.0
    )
    log_mel = librosa.power_to_db(mel, ref=np.max)

    # Force to exactly 128 columns; slice or edge-pad as needed.
    if log_mel.shape[1] > STAGE2_MEL_COLS:
        log_mel = log_mel[:, :STAGE2_MEL_COLS]
    elif log_mel.shape[1] < STAGE2_MEL_COLS:
        log_mel = np.pad(
            log_mel, ((0, 0), (0, STAGE2_MEL_COLS - log_mel.shape[1])), mode="edge"
        )

    log_mel = np.repeat(log_mel[:, :, np.newaxis], STAGE2_CHANNELS, axis=2)
    return log_mel.astype(np.float32)[np.newaxis, ...]  # batch of 1


# --------------------------------------------------------------------------
# Per-stage inference
# --------------------------------------------------------------------------
def stage1_healthy_probability(audio: np.ndarray) -> float:
    """Return p_healthy for one recording (Stage 1 is binary logistic)."""
    features = build_stage1_features(audio)
    dmatrix = _stage1_model.inplace_predict(features.reshape(1, STAGE1_FEATURE_DIM))
    return float(np.asarray(dmatrix).ravel()[0])


def stage2_copd_probability(audio: np.ndarray) -> float:
    """Return p_copd for one recording.

    The Stage 2 head is a single sigmoid unit trained COPD-vs-Pneumonia, so the
    output is the COPD probability and p_pneumonia = 1 - p_copd.
    """
    tensor = build_stage2_tensor(audio)
    output = _stage2_model.predict(tensor, verbose=0)
    return float(np.asarray(output).ravel()[0])


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
            "stage2_copd_prob": None,
            "healthy_prob": 1.0,
            "pneumonia_prob": 0.0,
            "copd_prob": 0.0,
            "clip_label": "Healthy",
        }

    p_copd = stage2_copd_probability(audio)
    p_pneumonia = 1.0 - p_copd
    label = "COPD" if p_copd >= STAGE2_COPD_THRESHOLD else "Pneumonia"
    return {
        "index": index,
        "duration_sec": round(len(audio) / SAMPLE_RATE, 2),
        "stage1_healthy_prob": round(p_healthy, 4),
        "stage1_routed_to_stage2": True,
        "stage2_copd_prob": round(p_copd, 4),
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
            "stage2_copd_threshold": STAGE2_COPD_THRESHOLD,
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
    stage2_copd_prob: Optional[float]
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
    stage2_copd_threshold: float


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
