# Model 1.5 (Healthy vs. Pathological) - Performance Report

## Overview
- **Architecture**: Tabular XGBoost with Aggregated Segment Features (MFCCs, Spectral Contrast, Energy)
- **Training Strategy**: Cost-Sensitive Learning (`scale_pos_weight`) using Full Training Data (No destructive undersampling)
- **Optimized Decision Threshold**: 0.61 (Healthy)

## Latest Test Performance Metrics
- **Accuracy**: 76.87%
- **Balanced Accuracy**: 74.67%
- **Macro F1-Score**: 0.7683

### Classification Breakdown
| Class | Precision | Recall | F1-Score | Support |
| :--- | :--- | :--- | :--- | :--- |
| **Pathological** | 0.784 | 0.852 | 0.817 | 81 |
| **Healthy** | 0.739 | 0.642 | 0.687 | 53 |

### Confusion Matrix
- **True Pathological**: 69 Predicted Pathological | 12 Predicted Healthy
- **True Healthy**: 19 Predicted Pathological | 34 Predicted Healthy
