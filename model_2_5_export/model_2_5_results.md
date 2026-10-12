# Model 2.5 (COPD vs. Pneumonia) - Performance Report

## Overview
- **Architecture**: EfficientNetB0 Transfer Learning (Dynamic Resizing to 224x224)
- **Training Strategy**: StratifiedGroupKFold Test Set Evaluation, 50/50 Physical Undersampling
- **Optimized Decision Threshold**: 0.47 (COPD)

## Latest Test Performance Metrics
- **Accuracy**: 72.48%
- **Balanced Accuracy**: 69.92%
- **Macro F1-Score**: 0.6987

### Classification Breakdown
| Class | Precision | Recall | F1-Score | Support |
| :--- | :--- | :--- | :--- | :--- |
| **COPD** | 0.607 | 0.613 | 0.610 | 362 |
| **Pneumonia** | 0.790 | 0.785 | 0.787 | 670 |

### Confusion Matrix
- **True COPD**: 222 Predicted COPD | 140 Predicted Pneumonia
- **True Pneumonia**: 144 Predicted COPD | 526 Predicted Pneumonia
