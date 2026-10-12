# Future / Needed Changes

Work that is deliberately **not** done yet. Nothing here blocks the current
build — it is a record of what is known to be missing, so it does not get lost.

Last updated: 2026-10-12

---

## 1. Digital stethoscope input

### The problem

Audio is captured from the **phone or laptop microphone**, not from a stethoscope.

`frontend-new/src/pages/Screening.tsx:196`:

```ts
const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
```

`{ audio: true }` means "give me the default input device", which on a phone is
the built-in mic. The models were trained on ICBHI respiratory recordings — real
auscultation, close-miked, through a chestpiece. Phone-mic audio is a different
acoustic domain: different microphone response, different distance, room
reverb, clothing noise, no chestpiece coupling.

**This gap is unmeasured.** It is the single largest risk to the accuracy of
every result the system produces.

### What a digital stethoscope changes

| | Phone mic (now) | Digital stethoscope (target) |
|---|---|---|
| Signal path | Air → phone mic | Chestpiece → chestpiece mic |
| Coupling | Ambient | Skin contact, sealed |
| Positioning | Whatever the phone is near | Clinician-placed |
| Sample rate | Device-dependent | Typically 16 kHz natively |
| Consistency | Varies per device, per use | Consistent across clinicians |

Consistent placement is what makes multi-take fusion meaningful. Right now two
"takes" may be recorded from two different distances.

### Before building this: the open questions

These need answering first, because they determine the entire approach.

1. **Which stethoscope?** Model and manufacturer. This decides everything —
   whether there is a usable SDK, whether it exposes Web Bluetooth, whether it
   enumerates as a normal audio input.
2. **Does it come with a browser SDK?** Vendor Web SDKs (WebAssembly, WebSocket)
   would be the smoothest path. Without one, the integration is raw Web Bluetooth.
3. **BLE or USB?** A USB Audio Class device needs no special handling — it just
   appears in `navigator.mediaDevices.enumerateDevices()` and the current code
   works after one `deviceId` lookup. A BLE device needs **Web Bluetooth**, which
   is Chromium-only and requires a user gesture per connection.
4. **One device per clinic, or per clinician?** Affects pairing UX and whether
   the device identity is stored per user.
5. **Fallback behaviour?** If the stethoscope is absent or disconnected, does
   recording refuse, or fall back to the phone mic with a loud warning?

### Rough shape of the change

**Device discovery and a connection check.** The user wants the Record button to
verify the stethoscope is online before recording rather than silently capturing
from the wrong source.

```ts
// Sketch only — shapes depend on answers to the questions above.
async function assertStethoscopeReady(): Promise<MediaStream> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  const stetho = devices.find(d => d.kind === 'audioinput' && isStethoscope(d))

  if (!stetho) {
    throw new StethoscopeNotConnected(
      'No stethoscope found. Connect it and try again.'
    )
  }

  // Bluetooth devices report deviceId === '' until permission is granted,
  // and BLE needs an explicit user gesture to pair.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { deviceId: { exact: stetho.deviceId }, ...constraints }
  })
  return stream
}
```

For BLE specifically the flow is `navigator.bluetooth.requestDevice()`, then a
service/characteristic subscription that yields PCM — not a `MediaStream` at all.
That is a substantially bigger job than a USB device and would replace the
`MediaRecorder` path entirely.

**UI changes on the Screening page:**

- A connection indicator before recording starts
- The Record button disabled with a reason when no stethoscope is present
- A clear message on disconnect *during* a take, rather than a truncated file
  being uploaded as if it were complete

**Backend impact:** likely none. Takes are already uploaded as individual
`.wav` files and scored independently; the source device does not change the
contract.

### Follow-on work

Once real stethoscope audio exists, re-measure the domain gap against the phone
mic. Until then, no accuracy figure from this system should be treated as
clinically meaningful — per-stage balanced accuracy numbers exist in
`MODEL_CARD.md`, but there is **no end-to-end measurement** for the deployed
configuration at all.

---

## 2. No inconclusive band

### The problem

Every screening returns a probability for all three classes and a single label.
A confident call and a coin-flip look identical in the interface.

```
Healthy 0.34 / Pneumonia 0.33 / COPD 0.33     <- rendered the same as
Healthy 0.91 / Pneumonia 0.05 / COPD 0.04        this, but neither is
                                                  flagged or distinguished
```

Both produce a `respiratory_result` of `Healthy` or `COPD` or `Pneumonia`, a
confidence figure, and the same clinical-recommendation panel. A clinician
reading a near-even distribution has no signal that the model was guessing.

Stage 1 does have an implicit floor — below 0.61 healthy it routes to Stage 2
rather than calling Healthy — but that routes to a *different label*, it does not
produce an "uncertain" state.

### Why it matters

Both stages sit around 70–75% balanced accuracy. Roughly a quarter of
classifications are wrong, and a meaningful slice of the remainder land near the
decision boundary where the model has no real confidence. Those are exactly the
cases that should be sent for human review, and right now there is no way to
identify them programmatically.

### Options, none implemented

**Confidence floor.** Reject when the top probability is below a threshold.
Simple, but a fixed cut is poorly calibrated across two differently-distributed
stages.

**Margin between top two.** Reject when `p₁ − p₂` is small. Measures genuine
separation rather than absolute confidence, so it handles a model that is
confidently wrong. Probably the best of the simple options.

**Entropy across all three.** Highest when the distribution is flat. Principled
and cheap to compute — the fused probabilities are already returned — but needs
a threshold tuned per stage.

**Abstention trained into the model.** A fourth "uncertain" class, or a
calibrated confidence head. This is the correct long-term answer and means
retraining, which is out of scope for now.

### Where it would go

- `packages/inference/inference_service.py` — `fuse_clips()`, adding an
  `inconclusive` outcome alongside the three labels
- `backend/models.py` — `RespiratoryResult` enum gains a member; needs a
  `CHECK` constraint migration on `screenings.respiratory_result`
- `backend/routes/api.py` — PDF report branch, and the clinical-recommendation
  wording, which would become "resample or refer for imaging" rather than a
  condition-specific next step
- `frontend-new/src/pages/ScreeningDetail.tsx` — a fourth state in the tier
  card, and a per-take column
- The screening list filter gains an option
- **Tests** — `packages/inference/test_fusion.py` has an 11-case decision table
  that would need the new branch pinned down, especially the interaction with the
  safety override: a high-confidence pneumonia override must still beat an
  inconclusive verdict, or the safety-first property in `MODEL_CARD.md` breaks

### Do not

Do not add this by quietly widening an existing threshold. The 0.61 and 0.47
values are tied to measured per-stage performance; moving them changes what the
models mean, not how uncertain results are displayed.