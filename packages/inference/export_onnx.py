#!/usr/bin/env python3
"""
Export ResNet18 PyTorch models to ONNX with dynamic batch axis.
Input: (1, 3, 224, 224) — ImageNet normalized, 3-channel spectrogram
"""
import torch
import torch.nn as nn
from torchvision import models
import onnx
import onnxruntime as ort
import numpy as np
from pathlib import Path

MODEL_DIR = Path(__file__).parent.parent.parent / "models"
MODEL_DIR.mkdir(exist_ok=True)

TB_GATEKEEPER_PTH = MODEL_DIR / "tb_gatekeeper_resnet18.pth"
RESPIRATORY_PTH = MODEL_DIR / "respiratory_classifier_resnet18.pth"

TB_ONNX = MODEL_DIR / "tb_gatekeeper_resnet18.onnx"
RESPIRATORY_ONNX = MODEL_DIR / "respiratory_classifier_resnet18.onnx"

IMAGE_NET_MEAN = [0.485, 0.456, 0.406]
IMAGE_NET_STD = [0.229, 0.224, 0.225]

def build_resnet18(num_classes: int) -> nn.Module:
    model = models.resnet18(weights=None)
    model.fc = nn.Linear(model.fc.in_features, num_classes)
    return model

def load_pytorch_model(pth_path: Path, num_classes: int) -> nn.Module:
    model = build_resnet18(num_classes)
    state_dict = torch.load(pth_path, map_location="cpu")
    # Handle possible key mismatches (e.g., 'module.' prefix from DataParallel)
    new_state_dict = {}
    for k, v in state_dict.items():
        new_k = k.replace("module.", "")
        new_state_dict[new_k] = v
    model.load_state_dict(new_state_dict)
    model.eval()
    return model

def export_to_onnx(model: nn.Module, onnx_path: Path, input_name: str = "input"):
    dummy_input = torch.randn(1, 3, 224, 224)
    
    torch.onnx.export(
        model,
        dummy_input,
        onnx_path,
        export_params=True,
        opset_version=17,
        do_constant_folding=True,
        input_names=[input_name],
        output_names=["output"],
        dynamic_axes={
            input_name: {0: "batch_size"},
            "output": {0: "batch_size"}
        },
        verbose=False
    )
    print(f"Exported: {onnx_path}")

def verify_onnx(onnx_path: Path):
    onnx_model = onnx.load(onnx_path)
    onnx.checker.check_model(onnx_model)
    print(f"ONNX model valid: {onnx_path}")

def test_inference(onnx_path: Path, num_classes: int):
    session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    dummy = np.random.randn(1, 3, 224, 224).astype(np.float32)
    outputs = session.run(None, {"input": dummy})
    assert outputs[0].shape == (1, num_classes), f"Shape mismatch: {outputs[0].shape}"
    print(f"Inference test passed: {onnx_path} -> output shape {outputs[0].shape}")

def main():
    print("=" * 60)
    print("Exporting TB Gatekeeper (2 classes: 0=Non-TB, 1=TB)")
    print("=" * 60)
    
    if not TB_GATEKEEPER_PTH.exists():
        print(f"ERROR: {TB_GATEKEEPER_PTH} not found!")
        return
    
    tb_model = load_pytorch_model(TB_GATEKEEPER_PTH, num_classes=2)
    export_to_onnx(tb_model, TB_ONNX)
    verify_onnx(TB_ONNX)
    test_inference(TB_ONNX, num_classes=2)
    
    print("\n" + "=" * 60)
    print("Exporting Respiratory Classifier (3 classes)")
    print("=" * 60)
    
    if not RESPIRATORY_PTH.exists():
        print(f"ERROR: {RESPIRATORY_PTH} not found!")
        return
    
    resp_model = load_pytorch_model(RESPIRATORY_PTH, num_classes=3)
    export_to_onnx(resp_model, RESPIRATORY_ONNX)
    verify_onnx(RESPIRATORY_ONNX)
    test_inference(RESPIRATORY_ONNX, num_classes=3)
    
    print("\n[OK] All models exported and verified!")

if __name__ == "__main__":
    main()