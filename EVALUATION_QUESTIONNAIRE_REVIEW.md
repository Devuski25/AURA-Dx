# Evaluation Questionnaire — Review and Replacement Proposals

**Source document:** `UQ.pdf` (4 pages, ISO/IEC 25010-style quality instrument, 5-point Likert, Filipino/English, 24 items across 6 subsections).

**Purpose:** a working document for updating the questionnaire. Every item that scored
Partial, Weak, Unverified or Wrong is listed with a verdict, and one to three replacement
wordings are proposed for each — so the instrument can be revised before it goes out to
respondents.

**How to read the tags on every replacement:**

| Tag | Meaning |
|---|---|
| ✅ | **True of the build as it stands.** The replacement can be used with no further app work. |
| 🔧 | **Needs an app change first.** The replacement becomes true only after the change described. |
| 📊 | **Researcher-measured.** A number for the thesis, not a respondent's opinion. |
| 📋 | **Instrument change.** A field, column or section to add to the form. |

**Item numbers are the ones in `UQ.pdf`**, so they can be referenced directly in review.

---

## 1. Summary

| Bucket | Count | Items |
|---|---|---|
| 🔴 Fails as written | 2 | 1.4, 4.2 |
| 🟡 Partial / Weak | 6 | 2.3, 3.2, 3.4, 4.4, 5.2, 5.3, 6.4 |
| 🟡 Not verified | 2 | 3.1, 6.2 |
| ✅ Passes, but fragile | 2 | 2.2, 4.1 |
| Structural gaps | 5 | see §4 |
| Document defects | 6 | see §5 |

**Three things matter more than the rest:**

1. **1.4** has no substitute until an end-to-end accuracy measurement exists.
2. **4.2** is the one item the system genuinely fails — and it is already flagged red in the PDF.
3. **Usability and security** are named in the DIRECTION and have no questions at all.

---

## 2. The items

### 1.4 — "gives the correct output" 🔴

**Verdict: unanswerable as written.** The item asks the model to be *correct*, and the
thesis cannot substantiate that:

| Figure | Value |
|---|---|
| Stage 1 (XGBoost), standalone | 76.87% accuracy / **74.67%** balanced accuracy |
| Stage 2 (EfficientNetB0), standalone | 72.48% accuracy / **69.92%** balanced accuracy |
| The notebook's own end-to-end run | **32.7% overall accuracy, 0.9% pneumonia recall** |
| **End-to-end, deployed configuration** | **Not measured** |

`SCOPE_AND_LIMITATIONS.md`: *"These do not compose into an end-to-end figure… no end-to-end
accuracy measurement exists yet for the deployed configuration. That should be measured
before any accuracy claim is made."*

Two training-data confounds inflate the reported figures: **all 1565 COPD files are exactly
20.00s** (std 0.00), and **sample rate is confounded with class** (4000 Hz: healthy 75,
pneumonia 15, COPD 0 of 862 distinct files). Resampling removes neither. There is also an
unmeasured **domain gap** — trained on ICBHI ambient/lab recordings, deployed on stethoscope
audio through a phone microphone.

**Replacements**

| ID | Wording | Tag |
|---|---|---|
| **1.4a** | "produces a result that is consistent with the probability values it displays" | ✅ |
| **1.4b** | "states a confidence level for every result, and identifies when a result is not confidently normal" | ✅ |
| **1.4c** | "does not present a screening result as a diagnosis" | ✅ |
| **1.4d** | *Not a respondent item.* The percentage of screenings where the system classification matched the clinician's own assessment, on a held-out set. | 📊 |

**Notes.** 1.4a is mechanically verified — the mismatch it describes (reported COPD, displayed
Healthy 60.0%) was a real shipped bug, now fixed and locked by `backend/test_classification.py`
and `backend/test_pdf_consistency.py`. 1.4b is demonstrable on screen: the copy literally reads
*"Recording was not confidently normal… This is not a confident finding of normal breathing,
and it is not a finding of disease."*

**Do not restore the original wording unless the end-to-end measurement exists.** A physician
will tick "5" meaning *"it looked right to me"*, and the thesis will not be able to substantiate
it.

---

### 2.3 — "maintains smooth operation even when handling long audio recording" 🟡

**Verdict: partial.** Long takes are handled fine, but there is **no quality gate** — a silent
or saturated take is averaged into the fusion with equal weight. The app warns but does not
reject.

**Replacements**

| ID | Wording | Tag |
|---|---|---|
| **2.3a** | "handles recordings of up to 90 seconds without loss of response" | ✅ |
| **2.3b** | "warns the user when a recording is too short or too loud to analyse reliably" | ✅ |
| **2.3c** | "excludes a recording that carries no usable signal from the result" | 🔧 |

**Notes.** 2.3a is directly testable — the training corpus range is 10–90s and the inference
window cap is enforced. 2.3c depends on the silence gate in 4.2b.

---

### 2.2 — "responds promptly when navigating between pages and submitting audio inputs" ✅ but fragile

**Not a failure today, but watch it.** Access tokens last one hour. This was genuinely broken
until recently — the ES256 verifier could never succeed, so every authenticated request made
a Supabase round-trip. Fixed with auto-refresh and retry-on-401, but a tab left open for an
hour is exactly what an evaluator might reproduce.

| ID | Wording | Tag |
|---|---|---|
| **2.2a** | "remains responsive during a long session without requiring the user to sign in again" | ✅ |

---

### 3.1 — "operates without functional errors across various web browsers" 🟡

**Verdict: not verified.** Developed and visually tested on **Chrome only**. No cross-browser
test in the repo, no browser support statement in the docs. Safari/iOS is stricter about the
audio device list and MediaRecorder mime types. Separately, `getUserMedia` requires a secure
context: production is HTTPS so that is fine, but the LAN dev mode at
`http://192.168.x.x:5174` is not, and Chrome will block the microphone there.

**Replacements**

| ID | Wording | Tag |
|---|---|---|
| **3.1a** | "operates without functional errors on the browsers and versions listed in the response block below" | ✅ after testing |
| **3.1b** | "presents the same layout and the same set of functions in every browser tested" | ✅ |
| **3.1c** | *Add to the response block:* "Browser and version used: ______" | 📋 |

> **No rewording substitutes for testing.** If Firefox, Safari and Edge cannot be tested
> before the evaluation runs, name only the browser that was tested and list the tested matrix
> as a limitation in Chapter 3. That is defensible; an unsupported four-browser claim is not.

---

### 3.2 — "seamlessly integrates and captures audio input directly from the provided electronic stethoscope hardware" 🟡

**Verdict: partial, and weaker than it was.** The HM-9250 enumerates as a USB PnP device and
is auto-selected, but the 5-second record-and-play-back — the only thing that actually
*proved* the audio came from the stethoscope rather than the room — has been removed. What
remains is a label-regex heuristic with no diagnostic left.

**Replacements**

| ID | Wording | Tag |
|---|---|---|
| **3.2a** | "automatically selects the connected digital stethoscope as the audio input, without manual configuration" | ✅ |
| **3.2b** | "identifies the connected stethoscope by name and displays which input it is recording from" | ✅ |
| **3.2c** | "provides a pre-recording check that confirms the audio is being captured from the stethoscope and not from the room" | 🔧 |

**Notes.** 3.2a describes the auto-select rule as built: bare external endpoint → stethoscope-shaped
label → lone external input. 3.2c requires reinstating the check — **this is the one change
worth making**, because it is what makes 3.2a and 3.2b demonstrable rather than asserted.

---

### 3.4 — "functions smoothly alongside other running applications or background tasks" 🟡

**Verdict: partial.** The Mini PC is ~8 GB running inference (both models resident) + backend
+ tunnel. There is a documented history of orphaned inference processes holding ~1.2 GB and
starving the next instance. The honest answer is: yes on the specified Mini PC, ~2 GB and
~2 minutes warm-up.

**Move this to the IT annex** — it is not answerable by a physician.

**Replacements**

| ID | Wording | Tag |
|---|---|---|
| **3.4a** | "runs on a standard clinic Mini PC (8 GB RAM, no GPU) without degrading other applications on the same machine" | ✅ |
| **3.4b** | "recovers automatically if a background service is stopped, without requiring a manual restart of the whole application" | ✅ |

---

### 4.1 — "consistently operates without crashing or generating unexpected system errors" ✅ but fragile

**Not a failure today, but it is the item most exposed to any single untested change.** The
shipped build had a PDF 500, a 401 storm from expired tokens, a classification bug reporting
COPD while showing Healthy 60%, and a deploy timeout that took the site down. All are fixed and
covered by automated tests now.

| ID | Wording | Tag |
|---|---|---|
| **4.1a** | "remains stable through a full screening session, from patient selection to the exported report" | ✅ |

**Recommendation:** soak-test the exact build that will be evaluated, and record the build
identifier on the form (see D.4).

---

### 4.2 — "effectively handles invalid inputs (e.g., background noise, non-breathing audio) by prompting the user to try again" 🔴

**Verdict: a genuine gap — and the one already highlighted in red in the PDF.**

**What the system does:**
- Detects a take below the minimum duration → *"Too short to analyse reliably — record a replacement if you can"*
- Detects a clipped / over-level take in the live meter → *"Too loud — move the stethoscope"*

**What it does not:**
- Detect background noise
- Detect a non-breathing clip
- Detect a detached stethoscope
- Detect a room recording
- Gate a silent or saturated take out of the fusion — a garbage take is averaged in with **equal weight** against a clean one

`SCOPE_AND_LIMITATIONS.md`: *"No noise suppression, echo cancellation, or heartbeat removal. No
check for clipping, silence, or a stethoscope detached from the chest."* And: *"Unweighted
fusion… There is no quality gate rejecting a silent or saturated take."*

**Removing the stethoscope check made this worse.** The check was the one surface that made a
bad recording *visible* — a clinician playing back 5 seconds would hear a room and know.
Without it, a room recording now produces a **confident-looking** result rather than an
obviously wrong one.

**Replacements**

| ID | Wording | Tag |
|---|---|---|
| **4.2a** | "warns the user when a recording is too short or too loud to analyse reliably" | ✅ |
| **4.2b** | "does not accept a recording that contains no usable signal as a valid take" | 🔧 |
| **4.2c** | "provides a way to confirm, before screening, that audio is being captured from the stethoscope and not from the room" | 🔧 |
| **4.2d** | *Not a respondent item.* The proportion of screening takes rejected as unusable. | 📊 |

**Recommendation: 4.2a + 4.2c together**, with the check reinstated as an *optional* pre-flight
so it adds no friction. That takes 4.2 from a genuine 3 to an honest 4, and is a real
improvement rather than a reword.

---

### 4.4 — "exports data files (e.g., PDF) match the exact information displayed on screen" 🟡

**Verdict: weak — "exact" is too strong.** True in substance, but the PDF is a deliberate
**subset** (the interpretation narrative is not printed), and the per-take headers read
"Stage 1 healthy / Stage 2 pneumonia" on the PDF versus "Stage 1 / Stage 2" on mobile.

**Replacements**

| ID | Wording | Tag |
|---|---|---|
| **4.4a** | "the exported PDF report contains the same patient details, result, per-take scores and probabilities that are shown on screen" | ✅ |
| **4.4b** | "the exported PDF and the on-screen result always state the same classification and the same confidence for the same screening" | ✅ |
| **4.4c** | "the exported PDF reproduces every section shown on screen" | 🔧 |

**Use 4.4b.** It converts a soft perception into a mechanically guaranteed property — verified
by `backend/test_pdf_consistency.py` and `backend/test_classification.py` — and a thesis
claim with a test behind it is worth a great deal in a defence.

---

### 5.2 — "clear system components and detailed error messages that make it easy for administrators to diagnose and fix technical issues" 🟡

**Verdict: partial.** Good: live admin health panel, specific user-facing errors, heartbeat
row, timestamped logs, self-checking deploy scripts. **Gap: no in-app error log viewer and
no audit-log UI** — `audit_logs` is written on every create/review/delete, but an
administrator cannot see it in the product.

This item also conflates two audiences. Split it.

**Replacements**

| ID | Wording | Tag |
|---|---|---|
| **5.2a** | "provides administrators with a live status view showing the health of the application, the analysis service and the database" | ✅ |
| **5.2b** | "shows the user a specific message when a step cannot be completed, together with what to do about it" | ✅ |
| **5.2c** | "keeps a searchable record of activity and errors that an administrator can review inside the application" | 🔧 |

**Notes.** 5.2b belongs in the common core — it is the half a physician actually experiences.
5.2c is the most visible missing piece for an IT evaluator, and the data is already being
written; only the screen is missing.

---

### 5.3 — "can be easily integrated with other external systems or platforms to build a larger application" 🟡

**Verdict: weak.** There *is* a clean REST API, a declared `HTTPBearer` security scheme, and a
live OpenAPI spec at `https://api.auradx.xyz/openapi.json` (16 paths, HTTP 200, no token
required). But: no published API documentation, no versioned paths, no webhook or event
interface.

**Replacements**

| ID | Wording | Tag |
|---|---|---|
| **5.3a** | "exposes a documented REST interface with standard authentication, so that results can be retrieved by another system" | ✅ |
| **5.3b** | "stores its data in a standard relational database with documented tables, so that the data can be exported or replicated independently" | ✅ |
| **5.3c** | "publishes versioned interfaces and notifies other systems when a new screening is completed" | 🔧 |

**Pair with an app change:** put the API documentation in the thesis appendix **and** gate
`/docs` behind authentication. That converts a public exposure into a documented, deliberate
decision — the panel will ask either way.

---

### 6.2 — "maintains a clear, structured, and readable layout across different display orientations" 🟡

**Verdict: not verified.** The responsive contract is **width-based** (375 / 768 / 1536) and
`scripts/check-responsive.py` reads class strings, not rendered output. **Landscape on a phone
has never been looked at.** Sticky headers, multi-column grids and 44px touch targets were
all reasoned about for portrait.

**Replacements**

| ID | Wording | Tag |
|---|---|---|
| **6.2a** | "remains fully usable, with every value readable, when the device is held in landscape" | ✅ after looking |
| **6.2b** | "shows the same information and the same available actions in portrait and in landscape" | ✅ |
| **6.2c** | *Add to the response block:* "Device and orientation used: ______" | 📋 |

> **This one cannot be fixed by rewording.** Rotate a phone, open the screening wizard, the
> dashboard and a result page, and confirm before the evaluation. It is the cheapest
> unverified item in the instrument.

---

### 6.4 — "operates reliably across different network environments (e.g., local clinic network, Wi-Fi, or mobile data)" 🟡

**Verdict: partial and ambiguous.** Wi-Fi and mobile data: yes. **"Local clinic network": only
if it has outbound internet** — the browser loads the app from Cloudflare and then calls
`api.auradx.xyz`, so a LAN with no internet link cannot reach the API. The Mini PC is
designed as a single-site appliance behind an internet connection. The wording invites the
wrong reading.

**Replacements**

| ID | Wording | Tag |
|---|---|---|
| **6.4a** | "can be accessed and used from any device with an internet connection, over either Wi-Fi or mobile data" | ✅ |
| **6.4b** | "keeps a recorded take on the device if the service cannot be reached, so that the recording is not lost" | ✅ |
| **6.4c** | "functions on a clinic network with no internet connection" | 🔧 |

**Use 6.4a + 6.4b together.** 6.4b is a genuinely good property that is currently invisible
to the instrument — the app literally says *"your takes are saved on this device — try again
once the Mini PC is back"* — and it demonstrates resilience rather than asserting it.

---

## 3. Items that pass as written — no change needed

| Item | Note |
|---|---|
| 1.1 | Full flow verified end-to-end: patient selection → 3–5 takes → per-take upload → fusion → result screen. |
| 1.2 | A genuine strength. One-page-per-screening PDF, combined one-file export, per-take table, probabilities, clinical recommendation, scope disclaimer, "not a diagnosis" footer. |
| 1.3 | Step indicator with working back-navigation, patient picker with search/filter/sort, 3-dot row menu, selection-based export, Dashboard, Patient Records, Admin. |
| 2.1 | `/api/status` median 7ms (was ~1000ms before the shared-client fix). Inference 5ms median. Real upload percentage; analysis phase capped below 100%. |
| 2.4 | Realtime on `screenings` and `profiles`, Dashboard subscribes, Admin 15s backstop, adaptive polling 30s→5min. |
| 3.3 | Per-take upload → inference → storage, verified repeatedly on the Mini PC. |
| 4.3 | Sub-0.2s audio rejected at inference; clean API errors; no crash path found. |
| 5.1 | React 19 + Vite + TS, Tailwind v4 + shadcn, FastAPI, one shared `clinical_copy.json` consumed by both screen and PDF, 8 migration files, 6 audit scripts. |
| 5.4 | Search by patient/clinic/clinician, filter by result class and gender, sort by date, Patient Records, dashboard counts, audit log on every mutation. |
| 6.1 | A genuine strength. 375/768/1024/1536 responsive contract, distinct phone and tablet layouts, safe-area insets, 44px tap targets, no horizontal scroll at 375px, enforced by `scripts/check-responsive.py`. |
| 6.3 | The step indicator makes completed steps real buttons; recorded takes and the selected site survive a step change. |

---

## 4. Structural gaps

### 4.1 Usability — named in the DIRECTION, zero questions

For a system a physician uses one-handed on a phone in a clinic, this is arguably the most
important dimension, and a physician evaluator cannot score what is not asked.

| ID | Item | Tag |
|---|---|---|
| **U.1** | "can be used to complete a screening without instruction" | ✅ |
| **U.2** | "explains in plain words what a result means and what to do about it" | ✅ |
| **U.3** | "the results I need are visible without having to search for them" | ✅ |
| **U.4** | "the controls I need are reachable on the device I am using" | ✅ |

### 4.2 Security — named in the DIRECTION, zero questions

The system stores patient names, dates of birth and audio. It has real, documentable
controls: Supabase Auth + Row Level Security, JWT with a role hierarchy (clinician / admin /
super_admin), `clinic_id` scoping, session expiry, an audit log on every
create/review/delete, and account approval gating. **None of it is captured.**

| ID | Item | Tag |
|---|---|---|
| **S.1** | "only users authorised for a patient can view that patient's records" | ✅ |
| **S.2** | "an account that is not approved cannot use the system" | ✅ |
| **S.3** | "my access ends when I stop using the system" | ✅ |
| **S.4** | "each access to a patient record is recorded for accountability" | ✅ |
| **S.5** | "recorded audio is protected from access by people who are not authorised to use the system" | 🔴 |

**On S.5 — ask it, answer it, treat it as a stated limitation.** The honest answer is
*"partially — files are unencrypted at rest on the backend host's disk."* Better that the
panel hears it from you.

### 4.3 One instrument for two respondent types

A physician and an IT engineer currently answer the identical 24 items.

- **Engineering concerns** (a physician cannot answer these): 3.4, 5.1, 5.2, 5.3, 6.4
- **Clinical concerns** (an IT evaluator cannot answer these): 1.2, 3.2, 4.2, 4.4

Forcing 1–5 on an inapplicable item records missing data as a number and pollutes the mean.
ISO 25010 practice is a common core plus a role-specific annex — and a split instrument also
lets you legitimately report separate physician and engineer scores, which reads better in a
thesis than one blended average.

### 4.4 "Acceptability" is the wrong word for what this measures

Part I is titled **"ACCEPTABILITY OF THE WEBSITE"**, but the items measure *product quality*
against ISO 25010. In the IS literature "acceptability" means the Technology Acceptance
construct — perceived usefulness, perceived ease of use, attitude toward use, intention to use.

Either rename Part I to **"Part I: System Quality Evaluation"** and add a short acceptability
section (4–5 items), or keep the name and be ready to justify it.

### 4.5 Clinical safety — no section at all

Nothing asks:

- Was the result clinically correct? (no end-to-end accuracy exists)
- Was the scope disclaimer understood — that a Healthy result does **not** exclude asthma,
  bronchiectasis, pulmonary fibrosis, pulmonary embolism, heart failure, upper-airway disease
  or TB?
- Would you act on a LOW-confidence result?
- Could a Healthy result be misread as "nothing is wrong"?

These are the highest-stakes questions in the thesis and the instrument asks none of them.

---

## 5. Document defects

| ID | Defect | Where | Severity | Fix |
|---|---|---|---|---|
| **D.1** | Brand written **"AURA\uFFFEDx"** — a Unicode *noncharacter* (U+FFFE) where the hyphen belongs | p.1 privacy notice | Medium | Render as **AURA-Dx** with a plain hyphen. It renders as a hyphen in some viewers and a missing-glyph box in others, and copies as `AURA\uFFFEDx`. Project rule: AURA-Dx, plain hyphen, in PDF reports. |
| **D.2** | Third respondent tick box reads **"Data Privacy Act"** | p.2 respondent block | Medium | Not a respondent type. Probably a privacy/legal/compliance officer, or a leftover. |
| **D.3** | No **N/A** column | all 24 items | Medium | Add one. Forces a 3 on inapplicable items. |
| **D.4** | No field for **build/version, evaluation date, device, browser** | respondent block | Medium | Without it, scores cannot be tied to a build or reproduced. |
| **D.5** | Privacy notice covers only "name and evaluation responses" — not that evaluating means **processing breathing audio through the system** | p.1 | Medium | That is the actual data flow an evaluator consents to. |
| **D.6** | "diagnostic outputs" (2.1), "diagnostic records" (5.4) | items 2.1, 5.4 | Low | The system **screens**; it does not diagnose. "diagnostic" reads as an over-claim to a panel. Use "screening outputs" / "screening records". |

**Keep as is:** the bilingual scale is correct and consistent. "Di-Tiyak" is the natural
Filipino for "uncertain" and better than "Hindi Ti-tiyak" for a single word. The scale being
repeated at every section header is good practice — no action.

---

## 6. Decision checklist

Tick the replacements to adopt.

### Question wording

- [ ] 1.4a · 1.4b · 1.4c — replace "gives the correct output"
- [ ] 2.2a — strengthen "responds promptly"
- [ ] 2.3a · 2.3b — replace "long audio recording"
- [ ] 3.1a · 3.1b — replace "various web browsers"
- [ ] 3.2a · 3.2b — replace "seamlessly integrates … stethoscope"
- [ ] 3.4a · 3.4b — replace "alongside other running applications"
- [ ] 4.1a — strengthen "consistently operates without crashing"
- [ ] 4.2a — replace "handles invalid inputs … try again"
- [ ] 4.4b — replace "match the exact information"
- [ ] 5.2a · 5.2b — split "clear system components and detailed error messages"
- [ ] 5.3a · 5.3b — replace "easily integrated with other external systems"
- [ ] 6.2a · 6.2b — replace "different display orientations"
- [ ] 6.4a · 6.4b — replace "different network environments"
- [ ] Add U.1–U.4 — usability section
- [ ] Add S.1–S.5 — security section
- [ ] Add a clinical-safety section (see §4.5)
- [ ] Add an acceptability section, or rename Part I (see §4.4)

### Instrument structure

- [ ] Add an N/A column to every item
- [ ] Add response fields: build/version evaluated, evaluation date, device + OS, browser + version, orientation used
- [ ] Fix the third respondent tick box
- [ ] Split into common core + physician annex + IT annex
- [ ] Fix "diagnostic" → "screening" in 2.1 and 5.4
- [ ] Fix the AURA-Dx brand character

### App work each wording depends on

- [ ] **A.1** Reinstate the stethoscope check as an optional pre-flight → unlocks 3.2c, 4.2c
- [ ] **A.2** Silence gate — reject a take with no usable signal → unlocks 2.3c, 4.2b
- [ ] **A.3** Audit-log / error-log viewer in Admin → unlocks 5.2c
- [ ] **A.4** Gate `/docs` + `/openapi.json` behind auth; fix the OpenAPI description (still says "Cough Sound Analysis") → supports 5.3a
- [ ] **A.5** Publish the API documentation in the thesis appendix
- [ ] **A.6** Restore the interpretation narrative to the PDF, if 4.4c is wanted

### Measurement (outside the questionnaire)

- [ ] **M.1** End-to-end accuracy on a held-out set — required before 1.4 has any substitute
- [ ] **M.2** Clinical agreement: % of screenings where the system classification matched the clinician's own assessment
- [ ] **M.3** Proportion of screening takes rejected as unusable
- [ ] **M.4** Test matrix: Chrome / Firefox / Safari / Edge, recorded on the form
- [ ] **M.5** Landscape check on a phone, across the screening wizard, dashboard and result page

---

## 7. Priority order

**Before the questionnaire goes out**

1. **M.1** — measure end-to-end accuracy. Without it, 1.4 has no substitute.
2. **A.1** and/or **A.2** — make 4.2 honestly answerable, or accept a genuine 3 on the one
   item the system fails.
3. **Add the usability and security sections** — the biggest coverage hole, and the app
   already has most of what they would ask for.
4. **D.1, D.2, D.5** — the brand character, the respondent box, the privacy notice.
5. **D.3, D.4** — the N/A column and the response fields.
6. **D.6** — "diagnostic" → "screening".
7. **M.4, M.5** — test the four browsers; rotate a phone.
8. Decide the role split (common core + two annexes).

**In the app, for the 🔧 wordings**

9. **A.3** — the audit-log viewer. The data is already written; only the screen is missing.
10. **A.4** — gate `/docs`, and fix the OpenAPI description. The spec is publicly reachable
    today and still carries a pre-rename "Cough Sound Analysis" name.
11. **A.5** — API documentation in the thesis appendix.
12. **A.2** — the silence gate, if 4.2b is adopted.
13. **A.1** — the optional stethoscope check, if 3.2c or 4.2c is adopted.
14. **A.6** — only if 4.4c is adopted.

---

## 8. Source of the technical claims

Every verdict in this document is checkable against the repository:

| Claim | Where to verify |
|---|---|
| No end-to-end accuracy measurement | `SCOPE_AND_LIMITATIONS.md` §Accuracy; `MODEL_CARD.md`; `DESIGN.md` |
| Training-data confounds (20.00s COPD files, sample rate) | `RECORDING_PROTOCOL.md` |
| No quality gate on silent or saturated takes | `SCOPE_AND_LIMITATIONS.md` §Audio handling limits, §Unweighted fusion |
| Audio unencrypted at rest | `SCOPE_AND_LIMITATIONS.md`; `DESIGN.md` |
| Domain gap (ICBHI ambient/lab → stethoscope via phone mic) | `SCOPE_AND_LIMITATIONS.md` §Domain gap |
| PDF/screen classification consistency | `backend/test_classification.py`, `backend/test_pdf_consistency.py` |
| PDF style line-height rule | `backend/test_pdf_styles.py` |
| Responsive contract | `scripts/check-responsive.py`, `agents.md` §Responsive contract |
| Public OpenAPI spec | `https://api.auradx.xyz/openapi.json` (unauthenticated) |
| Token expiry and refresh | `backend/auth.py`, `frontend-new/src/lib/api.ts` |
| Session expiry, role hierarchy, audit logging | `backend/auth.py`, `backend/routes/api.py`, `supabase/migrations/` |
