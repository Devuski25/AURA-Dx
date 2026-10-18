# Decision Logic — how a screening result is produced

How the model scores become a result a clinician reads, and why each rule is
shaped the way it is. This is the reference for
`packages/inference/inference_service.py::interpret_fusion` and
`shared/clinical_copy.json`.

---

## 1. What the models actually output

Two stages, run **per recording**. A clinician captures 3–5 takes.

| Stage | Model | Output | Threshold |
|---|---|---|---|
| 1 ("1.5") | XGBoost on a 153-d acoustic feature vector | `p_healthy` | `>= 0.61` → normal |
| 2 ("2.5") | EfficientNetB0 on a 64×128×3 log-mel tensor | `p_pneumonia` | `>= 0.47` → Pneumonia, else COPD |

### The polarity trap

Stage 2's sigmoid head was trained with `y = 1` for **Pneumonia**. The network
does **not** output `p_copd`.

```
p_copd = 1 - p_pneumonia
```

Reading the raw head output as "COPD confidence" inverts the classification:

| Head output | Actually | If misread as `p_copd` |
|---|---|---|
| `0.30` | COPD, 70% confident | "Pneumonia" ❌ |
| `0.78` | Pneumonia, 78% confident | "COPD" ❌ |

Every threshold below is expressed in COPD space, and `interpret_fusion` derives
that value explicitly rather than trusting a caller to have converted it.

---

## 2. How each recording contributes

This is the detail that makes the averaging behave the way it does.

| Stage 1 verdict | Contributes | Reaches Stage 2 |
|---|---|---|
| `p_healthy >= 0.61` | `(healthy 1.0, pneumonia 0.0, copd 0.0)` | **No** |
| `p_healthy < 0.61` | `(healthy 0.0, pneumonia = score, copd = 1 − score)` | Yes |

A recording that exits at Stage 1 has **no opinion** on COPD versus pneumonia. It
contributes zeroes to both. Note that a borderline recording (`p_healthy` around
0.50) **does** reach Stage 2 — the early exit is only above 0.61.

---

## 3. Why the split is read from Stage 2 recordings alone

Because of the table above, the fused class probabilities are a **majority vote
counted in probabilities**, not an average of model confidence. Three normal
recordings and two strongly-COPD ones give a fused COPD figure of `0.28` — which
against a single-take threshold of `0.60` would read as *pneumonia*.

The class choice itself is unaffected. Writing `n₂` for the number of recordings
that reached Stage 2:

```
mean_pneumonia > mean_copd
  ⟺  Σ pneumonia > Σ (1 − pneumonia)   over the n₂ Stage 2 recordings
  ⟺  mean(pneumonia | Stage 2) > 0.5
  ⟺  p_copd | Stage 2  <  0.5
```

So the **conditional average has exactly the same 0.5 boundary** as the fused
comparison, while sitting on a scale that means the same thing as one recording's
score. That is the value the bands are calibrated against, and why they land
symmetrically on 0.40 / 0.60.

`test_interpretation.py` asserts this equivalence across a grid of every
healthy/flagged split and every pneumonia probability in steps of 0.02, so the
claim cannot rot silently.

---

## 4. The deciding factor

**Averaged across recordings — with one exception that is deliberately not
averaged.**

> A single recording can win outright, **but only for pneumonia**, at `>= 0.60`.

Nothing else can. Not COPD, not Healthy. The reasoning is in the module
docstring and it is worth restating: lung pathology audible at one auscultation
site is routinely inaudible at another, so four reassuring recordings must not be
able to bury one alarming one. This trades specificity for sensitivity on
purpose — a missed acute pneumonia is far worse than a false alarm.

---

## 5. The decision table

Evaluated **in this order**; the first match wins.

| # | Condition | Status | Confidence | Rule recorded |
|---|---|---|---|---|
| 1 | any recording `p_pneumonia >= 0.60` | PNEUMONIA | HIGH | `safety_override` |
| 2 | mean healthy `>= 0.85` | HEALTHY | HIGH | `majority_healthy_confident` |
| 3 | mean healthy `0.61–0.85` | HEALTHY | MODERATE | `majority_healthy` |
| 4 | mean healthy `0.45–0.61` | HEALTHY | **LOW** | `borderline_healthy` |
| 5 | conditional `p_copd > 0.60` | COPD | HIGH | `conditional_copd_high` |
| 6 | conditional `p_copd 0.55–0.60` | COPD | MODERATE | `conditional_copd_moderate` |
| 7 | conditional `p_copd 0.45–0.55` | **ATYPICAL_OOD** | LOW | `conditional_undecidable` |
| 8 | conditional `p_copd 0.40–0.45` | PNEUMONIA | MODERATE | `conditional_copd_moderate` |
| 9 | conditional `p_copd < 0.40` | PNEUMONIA | HIGH | `conditional_copd_high` |

Two adjustments apply afterwards:

- **Agreement.** If the Stage 2 recordings spread more than `0.20` (standard
  deviation of their pneumonia probabilities), one confidence level is removed —
  except on ATYPICAL, which is already LOW.
- **Disclosed Healthy.** Any HEALTHY verdict with at least one recording that
  reached Stage 2 is downgraded one level. Four normal recordings plus one that
  did not agree is not a confident normal.

---

## 6. Worked scenarios

`healthy` is what each recording was told by Stage 1; `pneu` is its Stage 2
pneumonia probability. ✓ marks the expectation pinned by
`test_interpretation.py`.

| # | 5 recordings | Override | Averaged | Result |
|---|---|---|---|---|
| 1 | all 5 normal | no | 5/5 normal | **HEALTHY · High** ✓ |
| 2 | 3 normal + 2 flagged (pneu 0.30, 0.35) | no | healthy 0.60 | **HEALTHY · Low** ✓ |
| 3 | 4 normal + 1 clean flag | no | healthy 0.80 | **HEALTHY · Low** ✓ |
| 4 | all 5 strongly COPD (pneu 0.15) | no | cond. copd 0.85 | **COPD · High** ✓ |
| 5 | all 5 moderately COPD (pneu 0.42) | no | cond. copd 0.58 | **COPD · Moderate** ✓ |
| 6 | all 5 strongly pneumonia (pneu 0.80) | **yes** | — | **PNEUMONIA · High** ✓ |
| 7 | 4 normal + 1 at pneu 0.72 | **yes** | — | **PNEUMONIA · High** ✓ |
| 8 | 4 normal + 1 at pneu 0.30 | no | healthy 0.80 | **HEALTHY · Low** ⚠ see §7 |
| 9 | mixed 0.35 / 0.42 / 0.50 / 0.55 / 0.58 | no | cond. copd 0.52 | **ATYPICAL_OOD · Low** ✓ |
| 10 | split 0.05 / 0.08 / 0.10 / 0.55 / 0.58 | no | cond. copd 0.73 | **COPD · Moderate** ✓ |

**Row 7 is the override earning its place.** Four normal recordings would have
produced a HEALTHY verdict; the single alarming take overrides it. The report
says *"Acute pattern detected in recording 3. The other 4 were normal."*

**Row 10 is the agreement downgrade.** The average is decisive, but the readings
contradict each other, so confidence drops one level. "We looked and disagreed"
is a different problem from "the model was unsure", and the UI says which.

---

## 7. The known weakness, stated plainly

Four normal recordings plus one at `p_pneumonia = 0.30` (i.e. 70% COPD-leaning)
reports **HEALTHY**. The average is the right default — pathology audible at one
site often is not at another — and the override threshold sits above 0.60
deliberately so borderline noise cannot hijack a result.

But the result must never hide it. The UI and the PDF both disclose:

> *"One or more recordings was borderline and did not clear the disease screen."*

The alternative — letting any abnormal recording veto a Healthy verdict — was
rejected because it would produce many more borderline results on real patients,
which trains clinicians to ignore the warning.

---

## 8. Scope: what the model cannot say

Training classes were **COPD, healthy, pneumonia**. `URTI` was in the source
dataset and was deliberately removed before training.

The model has **no output for any other condition**. It cannot detect asthma,
bronchitis, URTI, heart failure or fibrosis — it has never been taught those
sounds. Any unfamiliar disease is forced onto the nearest trained class, **with
a confident number**, because the model is confident about features it does
recognise.

| Patient has | Likely result | Right? |
|---|---|---|
| Healthy | HEALTHY | ✅ |
| COVID pneumonia | PNEUMONIA | ✅ — it *is* pneumonia |
| Asthma | COPD | ⚠️ both obstructive; wrong disease |
| Bronchitis / URTI | COPD or PNEUMONIA | ❌ |
| Heart failure | **PNEUMONIA, High** | ❌ **dangerous** — crackles resemble pneumonia |
| Pulmonary fibrosis | PNEUMONIA | ❌ **dangerous** |

**ATYPICAL_OOD does not mitigate this.** It catches *uncertain* results only. A
heart-failure patient whose crackles look clearly like pneumonia gets
PNEUMONIA / High with no hesitation.

The protection is the wording, and it is enforced in
`shared/clinical_copy.json`:

- "Features **consistent with** …" — a match to a trained class, never a diagnosis
- No string names asthma, bronchitis, CHF or any other unrepresented condition
- The scope line is permanent and non-dismissible on every result and every PDF:
  *"This system evaluates COPD and pneumonia and cannot assess other causes of
  abnormal breathing sounds. A result is not a diagnosis."*

---

## 9. Where each piece lives

| Concern | Location | Why there |
|---|---|---|
| Thresholds, tiers, override | `packages/inference/inference_service.py` | Owns the constants; both test suites cover it |
| Wording | `shared/clinical_copy.json` | Read by **both** the React screen and the PDF generator, so they cannot drift |
| Screen | `frontend-new/src/components/InterpretationPanel.tsx` | |
| PDF | `backend/pdf_copy.py` | |
| Storage | `supabase/migrations/20261018000000_*.sql` | Additive; pre-existing rows read as legacy |

The database stores `recommendation_code` (`"COPD_HIGH"`), **not prose**, so
rewording a clinician-facing message needs no migration.

---

## 10. Verification

```bash
python packages/inference/test_fusion.py          # the 3-class decision table
python packages/inference/test_interpretation.py  # status + confidence bands
```

`test_interpretation.py` covers all four statuses across all three confidence
levels, the override, the agreement downgrade, and the conditional-vs-fused
equivalence invariant. Neither loads a model, so neither says anything about
whether the models are any good — only whether their numbers are reported
correctly.
