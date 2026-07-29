#!/usr/bin/env python3
"""
Inference Service — FastAPI service for cough sound analysis.
Cascade: TB Gatekeeper (0.45s slice) -> if Non-TB -> Respiratory (2.0s slice)
Input: Audio file -> Log-Mel spectrogram (n_mels=64, resized to 224x224) -> ONNX models

Preprocessing matches training pipeline exactly:
  - torchaudio.transforms.MelSpectrogram(sr=16000, n_fft=1024, hop_length=256, n_mels=64)
  - AmplitudeToDB, min-max normalization, repeat 3x, resize to (3, 224, 224)
"""
import os
import io
import json
import numpy as np
import librosa
import onnxruntime as ort
from scipy.ndimage import zoom
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional
from pathlib import Path
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

MODEL_DIR = Path(__file__).parent.parent.parent / "models"

TB_ONNX = MODEL_DIR / "tb_gatekeeper_resnet18.onnx"
RESPIRATORY_ONNX = MODEL_DIR / "respiratory_classifier_resnet18.onnx"

SAMPLE_RATE = 16000
N_MELS = 64
N_FFT = 1024
HOP_LENGTH = 256
IMG_SIZE = 224

TB_CLASSES = ["Non-TB", "TB"]
RESPIRATORY_CLASSES = ["Healthy", "Pneumonia", "COPD"]

TB_SLICE_DURATION = 0.45
RESPIRATORY_SLICE_DURATION = 2.0

tb_session: ort.InferenceSession = None
resp_session: ort.InferenceSession = None
tb_input_name: str = None
resp_input_name: str = None

MODEL_VERSION = "1.0.0"


def load_models():
    global tb_session, resp_session, tb_input_name, resp_input_name
    providers = ["CPUExecutionProvider"]
    
    logger.info(f"Loading TB Gatekeeper from {TB_ONNX}")
    tb_session = ort.InferenceSession(str(TB_ONNX), providers=providers)
    tb_input_name = tb_session.get_inputs()[0].name
    logger.info(f"TB model loaded, input: {tb_input_name}")
    
    logger.info(f"Loading Respiratory Classifier from {RESPIRATORY_ONNX}")
    resp_session = ort.InferenceSession(str(RESPIRATORY_ONNX), providers=providers)
    resp_input_name = resp_session.get_inputs()[0].name
    logger.info(f"Respiratory model loaded, input: {resp_input_name}")


def audio_to_logmel(audio: np.ndarray, sr: int, duration: float) -> np.ndarray:
    target_samples = int(duration * sr)
    if len(audio) > target_samples:
        peak_idx = np.argmax(np.abs(audio))
        start = max(0, peak_idx - target_samples // 2)
        end = min(len(audio), start + target_samples)
        if end - start < target_samples:
            start = max(0, end - target_samples)
        audio = audio[start:end]
    elif len(audio) < target_samples:
        audio = np.pad(audio, (0, target_samples - len(audio)), mode="constant")

    mel_spec = librosa.feature.melspectrogram(
        y=audio, sr=sr, n_mels=N_MELS, n_fft=N_FFT, hop_length=HOP_LENGTH, power=2.0
    )
    log_mel = librosa.power_to_db(mel_spec, ref=np.max)

    log_mel_min = log_mel.min()
    log_mel_max = log_mel.max()
    log_mel = (log_mel - log_mel_min) / (log_mel_max - log_mel_min + 1e-6)

    h, w = log_mel.shape
    zoom_y = IMG_SIZE / h
    zoom_x = IMG_SIZE / w
    log_mel = zoom(log_mel, (zoom_y, zoom_x), order=1)

    log_mel = np.stack([log_mel, log_mel, log_mel], axis=0).astype(np.float32)
    return log_mel


def run_tb_inference(logmel: np.ndarray) -> dict:
    logmel = np.expand_dims(logmel, axis=0)
    outputs = tb_session.run(None, {tb_input_name: logmel})
    logits = outputs[0][0]
    logits = logits - np.max(logits)
    probs = np.exp(logits) / np.sum(np.exp(logits))
    pred_idx = int(np.argmax(probs))
    return {
        "label": TB_CLASSES[pred_idx],
        "confidence": float(probs[pred_idx]),
        "probabilities": {TB_CLASSES[i]: float(probs[i]) for i in range(len(TB_CLASSES))}
    }


def run_respiratory_inference(logmel: np.ndarray) -> dict:
    logmel = np.expand_dims(logmel, axis=0)
    outputs = resp_session.run(None, {resp_input_name: logmel})
    logits = outputs[0][0]
    logits = logits - np.max(logits)
    probs = np.exp(logits) / np.sum(np.exp(logits))
    pred_idx = int(np.argmax(probs))
    return {
        "label": RESPIRATORY_CLASSES[pred_idx],
        "confidence": float(probs[pred_idx]),
        "probabilities": {RESPIRATORY_CLASSES[i]: float(probs[i]) for i in range(len(RESPIRATORY_CLASSES))}
    }


app = FastAPI(title="COUGHPH Inference Service", version=MODEL_VERSION)


@app.on_event("startup")
async def startup_event():
    load_models()


class InferenceResponse(BaseModel):
    model_version: str
    tb_result: dict
    respiratory_result: Optional[dict] = None
    cascade: str


@app.post("/api/inference", response_model=InferenceResponse)
async def inference(audio: UploadFile = File(...)):
    if not audio.filename.lower().endswith((".wav", ".mp3", ".flac", ".ogg", ".m4a")):
        raise HTTPException(status_code=400, detail="Unsupported audio format. Use wav, mp3, flac, ogg, m4a")
    
    try:
        audio_bytes = await audio.read()
        audio_data, sr = librosa.load(io.BytesIO(audio_bytes), sr=SAMPLE_RATE, mono=True)
        
        logger.info(f"Processing audio: {audio.filename}, duration: {len(audio_data)/SAMPLE_RATE:.2f}s")
        
        tb_logmel = audio_to_logmel(audio_data, SAMPLE_RATE, TB_SLICE_DURATION)
        tb_result = run_tb_inference(tb_logmel)
        
        response = {
            "model_version": MODEL_VERSION,
            "tb_result": tb_result,
            "cascade": "TB Gatekeeper only"
        }
        
        if tb_result["label"] == "Non-TB":
            resp_logmel = audio_to_logmel(audio_data, SAMPLE_RATE, RESPIRATORY_SLICE_DURATION)
            resp_result = run_respiratory_inference(resp_logmel)
            response["respiratory_result"] = resp_result
            response["cascade"] = "TB Gatekeeper -> Respiratory Classifier"
        
        logger.info(f"Inference complete: TB={tb_result['label']}, cascade={response['cascade']}")
        return JSONResponse(content=response)
        
    except Exception as e:
        logger.error(f"Inference error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health():
    return {"status": "healthy", "model_version": MODEL_VERSION, "models_loaded": tb_session is not None and resp_session is not None}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)