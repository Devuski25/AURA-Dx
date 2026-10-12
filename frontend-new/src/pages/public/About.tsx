import { Activity, AlertTriangle, ArrowRight, Check, ChevronDown, HeartPulse, Mic, Stethoscope, Waves, Wind, type LucideIcon } from "lucide-react"
import { PageHero } from "@/components/PageHero"
import { PageShell } from "@/components/PageShell"
import { SectionHeading } from "@/components/SectionHeading"
import { DrawRule, Reveal, Stagger, StaggerItem } from "@/components/Reveal"

/* Each description names the auscultatory signs associated with the class —
   what the microphone actually picks up — rather than restating the diagnosis.
   Wording stays descriptive, not diagnostic: this is what sounds are associated
   with in a screened population, not a criterion for calling it in a patient. */
const CONDITIONS: { icon: LucideIcon; name: string; desc: string }[] = [
  { icon: HeartPulse, name: "Healthy", desc: "Clear acoustic patterns — no signs of respiratory abnormality." },
  { icon: Wind, name: "COPD", desc: "Prolonged expiration with low-pitched wheezing and diminished breath sounds, as air trapping narrows the airway." },
  { icon: Waves, name: "Pneumonia", desc: "Fine crackles and bronchial breathing over consolidated lung, with breath sounds reduced on the affected side." },
]

const PREP_STEPS = [
  ["Resampling", "16,000 Hz, mono, from every take"],
  ["Band-pass filter", "100–2,000 Hz, 4th-order Butterworth, zero phase shift"],
  ["Cycle segmentation", "2.5 s windows stepping 1.25 s"],
  ["Level normalisation", "Peak amplitude, per cycle"],
]

const SMOOTH = "ease-[cubic-bezier(0.22,1,0.36,1)]"

function FlowNode({ icon: Icon, title, sub }: { icon: LucideIcon; title: string; sub: string }) {
  return (
    <div className={`group flex h-full flex-col items-center gap-2 rounded-2xl border border-aura-border-soft bg-aura-bg-card p-6 text-center transition-all duration-500 ${SMOOTH} hover:-translate-y-1 hover:border-aura-accent/40 hover:shadow-aura-card-hover`}>
      <span aria-hidden="true" className={`flex h-12 w-12 items-center justify-center rounded-full bg-aura-forest text-white transition-transform duration-500 ${SMOOTH} group-hover:scale-110`}>
        <Icon className="h-6 w-6" />
      </span>
      <p className="text-sm font-bold leading-snug text-aura-text">{title}</p>
      <p className="text-xs text-aura-muted">{sub}</p>
    </div>
  )
}

function FlowArrow() {
  return (
    <div aria-hidden="true" className="flex items-center justify-center text-aura-accent-dark">
      <ChevronDown className="h-6 w-6 sm:hidden" />
      <ArrowRight className="hidden h-6 w-6 sm:block" />
    </div>
  )
}

export function About() {
  return (
    <PageShell>
      <PageHero title="About the system" centered>
        Breathing is not random noise. Its acoustic shape carries information about the airway that produced it. AURA-Dx — the Acoustic Unit for Respiratory Assessment — is built to read that signature.
      </PageHero>

      {/* Flow */}
      <section className="bg-white px-6 py-16 md:py-24">
        <div className="mx-auto max-w-6xl">
          <SectionHeading>How the system works</SectionHeading>
          <Reveal as="p" delay={0.1} className="mt-3 max-w-[60ch] text-aura-muted">Three to five separate auscultation takes move through two classification stages, then a fusion step, before they become a single screening result.</Reveal>

          <Stagger className="mt-10 grid items-stretch gap-3 sm:grid-cols-[1fr_auto_1.15fr_auto_1fr]">
            <StaggerItem><FlowNode icon={Mic} title="Audio clips" sub="3–5 breathing takes" /></StaggerItem>
            <StaggerItem><FlowArrow /></StaggerItem>
            <StaggerItem><FlowNode icon={Stethoscope} title="Two-stage analysis" sub="Healthy screen, then COPD vs pneumonia" /></StaggerItem>
            <StaggerItem><FlowArrow /></StaggerItem>
            <StaggerItem><FlowNode icon={Activity} title="Screening result" sub="Fused confidence and suggested next step" /></StaggerItem>
          </Stagger>

          <Stagger className="mt-6 grid gap-4 sm:grid-cols-2">
            <StaggerItem className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-5">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-700" aria-hidden="true" />
              <p className="text-sm leading-relaxed text-gray-900">
                <strong className="font-semibold">Condition flagged.</strong> The result is surfaced immediately for clinician review.
              </p>
            </StaggerItem>
            <StaggerItem className="flex items-start gap-3 rounded-xl border border-green-200 bg-green-50 p-5">
              <Check className="mt-0.5 h-5 w-5 shrink-0 text-green-700" aria-hidden="true" />
              <p className="text-sm leading-relaxed text-gray-900">
                <strong className="font-semibold">No abnormality.</strong> The recording classifies as healthy, with the confidence score recorded.
              </p>
            </StaggerItem>
          </Stagger>
        </div>
      </section>

      {/* Classes */}
      <section className="bg-aura-mint-wash px-6 py-16 md:py-24">
        <div className="mx-auto max-w-6xl">
          <SectionHeading>What we screen for</SectionHeading>
          <Reveal as="p" delay={0.1} className="mt-3 max-w-[60ch] text-aura-muted">Three respiratory classes in one pass. This is screening support, not a medical diagnosis.</Reveal>
          <Stagger as="dl" className="m-0 mt-10 grid gap-x-10 gap-y-8 md:grid-cols-3">
            {CONDITIONS.map((c, i) => (
              <StaggerItem key={c.name} className="group">
                <DrawRule className="h-0.5 bg-aura-forest" delay={0.15 + i * 0.1} />
                <dt className="mt-5 flex items-center gap-3 font-display text-lg font-bold text-aura-text">
                  <c.icon className={`h-5 w-5 text-aura-forest transition-transform duration-500 ${SMOOTH} group-hover:scale-125`} aria-hidden="true" />
                  {c.name}
                </dt>
                <dd className="m-0 mt-2 max-w-[40ch] text-sm leading-relaxed text-aura-muted">{c.desc}</dd>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* Pipeline */}
      <section className="bg-white px-6 py-16 md:py-24">
        <div className="mx-auto max-w-6xl">
          <SectionHeading>How a recording is analyzed</SectionHeading>
          <div className="mt-10 grid gap-14 md:grid-cols-2 md:gap-16">
            <div>
              <Reveal>
                <h3 className="font-display text-lg font-bold text-aura-text">Preparing the audio</h3>
                <p className="mt-2 max-w-[56ch] text-sm leading-relaxed text-aura-muted">
                  Every take is resampled to a common rate, band-limited to the range that carries respiratory acoustics, split into overlapping breath cycles, and level-normalised so recording volume cannot move the result.
                </p>
              </Reveal>
              <Stagger as="ol" className="m-0 mt-6 list-none border-b border-aura-border p-0">
                {PREP_STEPS.map(([step, detail], i) => (
                  <StaggerItem as="li" key={step} className="group relative grid grid-cols-[2rem_1fr] py-4">
                    <DrawRule className="absolute inset-x-0 top-0 h-px bg-aura-border" delay={i * 0.08} />
                    <span className="text-sm font-bold tabular-nums text-aura-accent-dark">{i + 1}</span>
                    <div className={`transition-transform duration-500 ${SMOOTH} group-hover:translate-x-1`}>
                      <p className="text-sm font-semibold text-aura-text">{step}</p>
                      <p className="mt-0.5 text-sm text-aura-muted">{detail}</p>
                    </div>
                  </StaggerItem>
                ))}
              </Stagger>
            </div>

            <div className="flex flex-col gap-10">
              <Reveal delay={0.1}>
                <h3 className="font-display text-lg font-bold text-aura-text">Stage 1 — the healthy screen</h3>
                <p className="mt-2 max-w-[56ch] text-sm leading-relaxed text-aura-muted">
                  A gradient-boosted model reads a 153-value summary of each breath cycle — 13 MFCCs and their first and second derivatives, plus spectral centroid, bandwidth, contrast, flatness, zero-crossing rate and energy — collapsed across cycles by mean, maximum and spread. Confidently normal breathing stops here and never reaches the second stage.
                </p>
              </Reveal>
              <Reveal delay={0.2}>
                <h3 className="font-display text-lg font-bold text-aura-text">Stage 2 — COPD against pneumonia</h3>
                <p className="mt-2 max-w-[56ch] text-sm leading-relaxed text-aura-muted">
                  Anything Stage 1 flags as abnormal is converted to a 64-band log-Mel spectrogram and handed to a convolutional network, which scores the likelihood of pneumonia. A single breath cycle is one training example, so longer takes are scored in overlapping windows and the highest reading is kept.
                </p>
              </Reveal>
              <Reveal delay={0.3}>
                <h3 className="font-display text-lg font-bold text-aura-text">Fusing the takes</h3>
                <p className="mt-2 max-w-[56ch] text-sm leading-relaxed text-aura-muted">
                  The per-take scores are averaged so a single noisy recording cannot swing the verdict. One deliberate exception: if any single take is strongly positive for pneumonia, that finding wins. Pathology audible at one auscultation site can be inaudible at another, and a missed pneumonia matters more than a false alarm.
                </p>
              </Reveal>
              <Reveal delay={0.4}>
                <h3 className="font-display text-lg font-bold text-aura-text">A result with its confidence</h3>
                <p className="mt-2 max-w-[56ch] text-sm leading-relaxed text-aura-muted">
                  Every screening returns a per-class probability. Low-confidence results are flagged for manual clinician review rather than presented as a firm finding.
                </p>
              </Reveal>
            </div>
          </div>
        </div>
      </section>
    </PageShell>
  )
}
