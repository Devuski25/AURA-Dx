# AURA-Dx Project Brief

## 1. Project Overview

**What is this product?** (1-2 sentences)

- its a web app for analyzing cough sounds for respiratory diseases(COPD, TUBERCULOSIS, PNUEMONIA and HEALTHY)
  **Who is the target user?** (patients, clinicians, researchers, admins)
- doctors and patients that wants a screening and diagnosis from only analyzing their cough
  **What problem does it solve?** (core pain point)
- A realiable screening software/web app, we will be testing it against a real doctors diagnosis

---

## 2. Current State

**What exists now?**

- Frontend: aura-dx/ (HTML/CSS/JS)
- Backend: CoughPH-Backend - Copy/ (Flask + ML models)
- Database: SQLite (coughph.db)
- ML Models: ResNet18 classifiers (respiratory + TB gatekeeper) i already have the pytorch models named "respiratory_classifier_resnet18.pth" and "tb_gatekeeper_resnet18.pth"

**What's working?** (list features already functional)

- the screening part(record and upload cough audio)
- login needs a bit more adjustment and improvement

**What's broken/missing?** (known issues)

- when logging in as doctor/clinician i dont have a seperate web page that shoulve have the following:
  - a screening page maybe a button that has a plus and says "New Patient" which will go to another page and take the info of the patient(Birthday which the auto complete by computing the Age and appearing in the age part it calculated age, the patients name, gender, and then a few activies will also be ask like related to smoking, drinking, past respiratory disease and ofcourse some current symptoms like headache, fever, dry cough, wet cough, etc other sysmptoms that may relate to the 3 respiratory diseases) and then after taking that short fill up form it will proceed to the screening page(i want that screening.html file to be here and remove to the front page of the web(the before login page) ofcourse i want the design to also be better and the same two functions still remain(the record and upload cough audios)then after that it will proceeds to the page of the result(this is still msising i dont have a results page) which will shows the percentage and result of the models analysis and it will proceed to list/show some recommendations on what to do, avoid and the cause which will differ based on the 4 categories the models analysis is) and then after that it will ofcourse save it to the database which will shows to the other part of the doctors page which is the history of all of the recorded patients diagnosis which can be sorted by date, condition/result, gender, and age(maybe 1-12, 13-21, 22-35 and 35+) and theres also a search bar to search a specific patients name.
  - the admin/superadmins page which should have access to all of the save data from the patients records such as the doctors page like all of the fuction of the doctors page but not the new patients function and the admins page should also have a list of all of the doctors account and details like the login and logout time and also have the function of approving, rejecting new doctors accounts and deleting new or exisiting doctors account and also be able to delete any records of the patients and doctors so basically like what an systems admin powers should have.
  - about the screening part i also want to have python program named "audio-process.py"which does this:
    You are building a two-tier respiratory diagnosis system using two distinct, pre-trained ResNet18 models.The system uses two models because your training data came from two completely different source datasets with different audio duration limits:Model 1 (TB Gatekeeper): Trained on a dataset where clips were very short (under 0.5 seconds). It acts as the initial screening layer to classify whether a cough indicates Tuberculosis (TB) or Non-TB.Model 2 (Respiratory Classifier): Trained on a separate dataset with longer audio recordings. It handles broad classification to differentiate between Healthy, Pneumonia, and COPD.2. The Multi-Stage Logic FlowWhen a user submits a single audio file, it undergoes a single shared preprocessing pipeline that yields two distinct time-window slices from the exact same peak anchor point:Step 1 (Ingestion & Filtering): Convert audio to 16,000 Hz Mono and pass it through a 3,000 Hz low-pass filter to remove high-frequency noise/artifacts.Step 2 (Peak Alignment): Find the single loudest point (absolute peak amplitude) in that filtered audio buffer.Step 3 (Dual Slicing):Tier 1 Slice: Cut a short 0.34-second window centered on that peak.Tier 2 Slice: Cut a wider 2.0-second window centered on that exact same peak.Step 4 (Tensor Generation): Convert both audio slices into 64-mel Log-Mel Spectrograms, apply the exact normalization/resizing steps expected by ResNet18, and output two tensors.3. Execution Pipeline in ProductionInference Tier 1: The 0.34-second tensor is fed into Model 1 (TB Gatekeeper).Branching Rule:If Model 1 detects TB, the evaluation stops (or flags TB directly).If Model 1 detects Non-TB, the system automatically falls back to pass the 2.0-second tensor into Model 2 to classify if the patient is Healthy, has Pneumonia, or has COPD. and after that it will show the result in the results page.

---

## 3. Design & Brand

**Color palette:** (hex codes or reference images)

- just pick colors that look professional and not just black and white

**Typography:** (font preferences)

- non suprise me

**Logo/brand assets:** (do you have these, or need them created?)

- AURA-Dx is the named and maybe you could help me created some of the images/gifs/videos that will help my webapp look les ai slop and better

**Design references:** (links to sites/apps you like)
-dont have any

**Tone:** (clinical/professional, friendly/approachable, modern/tech, etc.)

- i want it to be clinical/professional but making it also have modern design/ tech

---

## 4. Core Features (MVP)

### Authentication & Users

- [ ] Login / Register
- [ ] Role-based access (clinician, admin/superadmin)
- [ ] Password reset / email verification
- [ ] Session management

### Screening / Core Flow

- [ ] Audio upload (cough recording)
- [ ] ML inference (respiratory + TB classification)
- [ ] Results display (probability scores, risk levels)
- [ ] History / past screenings

### Dashboard

- [ ] Patient: personal screening history, results
- [ ] Clinician: patient list, review queue, bulk actions
- [ ] Admin: user management, system stats, model metrics

### Additional Features

- [ ] PDF report generation
- [ ] Notifications (email, in-app)
- [ ] Export data (CSV, PDF)
- [ ] Multi-language support

---

## 5. Technical Requirements

**Backend:**

- Framework: Flask (current) / FastAPI / other?, give me suggestion for the best actions
- Database: SQLite → PostgreSQL / keep SQLite?, i kinda want to use supabase since im gonna be deploying it
- Auth: JWT / session cookies / OAuth?, give me suggestion for the best actions
- API style: REST / GraphQL?, give me suggestion for the best actions

**Frontend:**

- Current: vanilla HTML/CSS/JS
- Migrate to: React / Vue / Svelte / keep vanilla?
- State management: if framework
- Build tool: Vite / Webpack / none?
- give me your best suggestions

**ML/Inference:**

- Current: PyTorch .pth models loaded at startup
- Serving: in-process / separate service / ONNX / TensorRT?
- Batch vs real-time?
- GPU / CPU?
- give me your best suggestions

**Infrastructure:**

- Hosting: local / VPS / cloud (AWS/GCP/Azure) / Vercel / Railway?
- Containerization: Docker?
- CI/CD: GitHub Actions?
- Monitoring: logs, metrics, error tracking?
- give me your best suggestion

---

## 6. Data & Privacy

**Data stored:** (audio files, results, user info, analytics)

**Retention policy:** (how long to keep data)

**Compliance:** HIPAA / GDPR / local regulations?

**Anonymization:** (for model training / research)

---

## 7. Scale & Performance

**Expected users:** (daily/monthly active)

- none
  **Concurrent screenings:** (peak load)
- dont know
  **Response time target:** (inference + API < X ms)
- dont know
  **Audio file size limits:**
- nothing above 5mb

---

## 8. Roadmap (Post-MVP)

**Phase 2 features:**

**Phase 3 features:**

**Known technical debt:**

---

## 9. Team & Workflow

**Team size:** (devs, designers, ML, ops)

**Current workflow:** (branching, reviews, deploy process)

**Preferred workflow:**

---

## 10. Open Questions / Decisions Needed

1. i want you to give me suggestion and ask me as much questions needed to make this project better and look good, work good and deployment ready
2. also in those parts that i didnt mention mostly the content of those html files keep is there for those part i mostly just want it to look better and making it less of ai slop and make it a great looking website with animations and great designs.
3.

---

## 11. Additional Context

(Anything else: constraints, deadlines, stakeholder requirements, competitor analysis, etc.)
