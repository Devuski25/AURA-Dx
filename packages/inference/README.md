# Inference Package — ONNX Export & Runtime

## Directory Structure
```
packages/inference/
├── export_onnx.py      # Export .pth → .onnx
├── requirements.txt    # Python dependencies
└── Dockerfile.dev      # Dev container
models/                 # (repo root) .pth and .onnx files
├── tb_gatekeeper_resnet18.pth
├── respiratory_classifier_resnet18.pth
├── tb_gatekeeper_resnet18.onnx
└── respiratory_classifier_resnet18.onnx
```

## Quick Start

### 1. Install dependencies
```bash
cd packages/inference
pip install -r requirements.txt
```

### 2. Place your .pth models
```bash
# From repo root
mkdir -p models
cp /path/to/tb_gatekeeper_resnet18.pth models/
cp /path/to/respiratory_classifier_resnet18.pth models/
```

### 3. Export to ONNX
```bash
cd packages/inference
python export_onnx.py
```

### Expected Output
```
============================================================
Exporting TB Gatekeeper (2 classes: 0=Non-TB, 1=TB)
============================================================
Exported: /path/to/models/tb_gatekeeper_resnet18.onnx
ONNX model valid: /path/to/models/tb_gatekeeper_resnet18.onnx
Inference test passed: /path/to/models/tb_gatekeeper_resnet18.onnx → output shape (1, 2)

============================================================
Exporting Respiratory Classifier (3 classes)
============================================================
Exported: /path/to/models/respiratory_classifier_resnet18.onnx
ONNX model valid: /path/to/models/respiratory_classifier_resnet18.onnx
Inference test passed: /path/to/models/respiratory_classifier_resnet18.onnx → output shape (1, 3)

✅ All models exported and verified!
```

## Model Specifications

| Model | Classes | Input | Output |
|-------|---------|-------|--------|
| TB Gatekeeper | 2 (Non-TB, TB) | (batch, 3, 224, 224) | (batch, 2) |
| Respiratory | 3 (Healthy, Pneumonia, COPD) | (batch, 3, 224, 224) | (batch, 3) |

## Input Preprocessing (matching training)
```python
# ImageNet normalization
mean = [0.485, 0.456, 0.406]
std = [0.229, 0.224, 0.225]

# Audio → Log-Mel Spectrogram (64 mel, 224x224) → 3-channel (stack or replicate)
# → normalize with above mean/std
```

## Runtime Inference (ONNX Runtime)
```python
import onnxruntime as ort
import numpy as np

session = ort.InferenceSession("models/tb_gatekeeper_resnet18.onnx", providers=["CPUExecutionProvider"])
input_name = session.get_inputs()[0].name

# dummy input
x = np.random.randn(1, 3, 224, 224).astype(np.float32)
outputs = session.run(None, {input_name: x})
probs = outputs[0]  # shape (1, 2)
```