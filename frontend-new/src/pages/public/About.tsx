import { motion, useReducedMotion } from "framer-motion"
import { Activity, AlertTriangle, Check, ChevronDown, HeartPulse, Mic, ShieldCheck, Stethoscope, Waves, Wind, type LucideIcon } from "lucide-react"
import { cardHover, fadeUp, spring, staggerContainer, staggerItem } from "@/lib/motion"

const CONDITIONS: { icon: LucideIcon; name: string; chip: string; desc: string }[] = [
  { icon: HeartPulse, name: "Healthy", chip: "bg-green-100 text-green-700", desc: "Clear acoustic patterns — no signs of respiratory abnormality." },
  { icon: Wind, name: "COPD", chip: "bg-amber-100 text-amber-800", desc: "Indicators such as wheezing and prolonged expiration patterns." },
  { icon: Waves, name: "Pneumonia", chip: "bg-orange-100 text-orange-800", desc: "Patterns consistent with lung inflammation or infection." },
  { icon: AlertTriangle, name: "Tuberculosis", chip: "bg-red-100 text-red-700", desc: "Acoustic markers flagged immediately by the Tier 1 gatekeeper." },
]

function FlowNode({ icon: Icon, title, sub, delay = 0 }: { icon: LucideIcon; title: string; sub: string; delay?: number }) {
  const reduceMotion = useReducedMotion()
  const hoverProps = reduceMotion ? {} : { whileHover: { y: -3, transition: spring.snappy } }
  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 16, scale: 0.95 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, amount: 0.5 }}
      transition={{ type: "spring", stiffness: 120, damping: 14, mass: 0.8, delay }}
      {...hoverProps}
      className="group flex flex-col items-center gap-2 rounded-2xl border border-aura-border-soft bg-aura-bg-card p-5 text-center shadow-aura-card transition-shadow duration-300 hover:shadow-aura-card-hover"
    >
      <span
        aria-hidden="true"
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-aura-accent-light to-aura-accent-dark shadow-aura-sm transition-transform duration-300 group-hover:scale-110"
      >
        <Icon className="h-6 w-6 text-white" />
      </span>
      <p className="m-0 text-sm font-bold leading-snug text-aura-text">{title}</p>
      <p className="m-0 text-xs text-aura-muted">{sub}</p>
    </motion.div>
  )
}

function FlowConnector({ delay = 0 }: { delay?: number }) {
  const reduceMotion = useReducedMotion()
  return (
    <div aria-hidden="true" className="flex items-center justify-center">
      <svg viewBox="0 0 24 44" className="h-11 w-6 sm:hidden" fill="none">
        <motion.line
          x1="12" y1="4" x2="12" y2="40"
          stroke="var(--color-aura-accent-dark)"
          strokeWidth="2" strokeLinecap="round"
          initial={reduceMotion ? false : { pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.45, delay, ease: "easeOut" }}
        />
        {!reduceMotion && (
          <motion.circle
            cx="12" cy="4" r="3" fill="var(--color-aura-accent)"
            animate={{ cy: [4, 4, 40, 40], opacity: [0, 1, 1, 0] }}
            transition={{ duration: 1.4, times: [0, 0.15, 0.85, 1], repeat: Infinity, repeatDelay: 0.6, ease: "easeInOut", delay: delay + 0.5 }}
          />
        )}
      </svg>
      <svg viewBox="0 0 44 24" className="hidden h-6 w-11 sm:block" fill="none">
        <motion.line
          x1="4" y1="12" x2="40" y2="12"
          stroke="var(--color-aura-accent-dark)"
          strokeWidth="2" strokeLinecap="round"
          initial={reduceMotion ? false : { pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.45, delay, ease: "easeOut" }}
        />
        {!reduceMotion && (
          <motion.circle
            cx="4" cy="12" r="3" fill="var(--color-aura-accent)"
            animate={{ cx: [4, 4, 40, 40], opacity: [0, 1, 1, 0] }}
            transition={{ duration: 1.4, times: [0, 0.15, 0.85, 1], repeat: Infinity, repeatDelay: 0.6, ease: "easeInOut", delay: delay + 0.5 }}
          />
        )}
      </svg>
    </div>
  )
}


export function About() {
  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-[#0a352e] via-[#0d4a3f] to-aura-forest px-6 py-24 text-center">
        <div aria-hidden="true" className="absolute inset-0 aura-dots opacity-30" />
        <div className="relative z-10 mx-auto max-w-[720px]">
          <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/8 px-4 py-2 text-xs font-semibold tracking-wide text-white/75 backdrop-blur-sm">
            <Activity className="h-3.5 w-3.5" aria-hidden="true" />
            How It Works
          </span>
          <h1 className="text-[clamp(2rem,4vw,3rem)] font-bold leading-tight tracking-tight text-white">
            About the System
          </h1>
          <p className="mx-auto mt-5 max-w-[58ch] text-lg leading-relaxed text-white/70">
            Coughing is not random noise. Its acoustic shape carries information about the airway that produced it. AURA-Dx — the Acoustic Unit for Respiratory Analysis — is built to read that signature.
          </p>
        </div>
      </section>

      {/* How the System Works */}
      <section className="aura-dots bg-aura-bg-alt px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-[1.65rem] font-bold tracking-tight text-aura-text md:text-[2rem]">How the System Works</h2>
          <p className="mt-2 text-aura-muted">One audio clip moves through two gated stages before it becomes a screening result.</p>

          <div className="mt-10 grid items-stretch gap-3 sm:grid-cols-[1fr_auto_1.15fr_auto_1.15fr_auto_1fr]">
            <FlowNode icon={Mic} title="Audio Clip" sub="Cough recording" delay={0} />
            <FlowConnector delay={0.12} />
            <FlowNode icon={ShieldCheck} title="Tier 1 · TB Gatekeeper" sub="Focused tuberculosis screen" delay={0.22} />
            <FlowConnector delay={0.34} />
            <FlowNode icon={Stethoscope} title="Tier 2 · Respiratory Classifier" sub="COPD · Pneumonia · Healthy" delay={0.44} />
            <FlowConnector delay={0.56} />
            <FlowNode icon={Activity} title="Screening Result" sub="Confidence score + suggested next step" delay={0.66} />
          </div>

          <motion.div variants={staggerContainer} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.5 }} className="mt-6 grid gap-4 sm:grid-cols-2">
            <motion.div variants={staggerItem} className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-5 shadow-aura-xs">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-700" aria-hidden="true" />
              <p className="m-0 text-sm leading-relaxed text-gray-900">
                <strong className="font-semibold">TB detected</strong> — the pipeline stops at Tier 1 and alerts the clinician immediately.
              </p>
            </motion.div>
            <motion.div variants={staggerItem} className="flex items-start gap-3 rounded-xl border border-green-200 bg-green-50 p-5 shadow-aura-xs">
              <Check className="mt-0.5 h-5 w-5 shrink-0 text-green-700" aria-hidden="true" />
              <p className="m-0 text-sm leading-relaxed text-gray-900">
                <strong className="font-semibold">TB-negative</strong> — audio proceeds to Tier 2 for respiratory classification.
              </p>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* What We Screen For */}
      <section className="px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-[1.65rem] font-bold tracking-tight text-aura-text md:text-[2rem]">What We Screen For</h2>
          <p className="mt-2 text-aura-muted">
            Four respiratory classes in one pass — screening support, not a medical diagnosis. Tap a class to see its markers.
          </p>
          <motion.div variants={staggerContainer} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.2 }} className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {CONDITIONS.map((condition) => (
              <motion.div key={condition.name} variants={staggerItem} className="transition-transform duration-300 hover:-translate-y-1">
                <details className="group h-full rounded-2xl border border-aura-border-soft bg-aura-bg-card shadow-aura-card transition-all duration-300 hover:shadow-aura-card-hover">
                  <summary className="flex cursor-pointer list-none items-center gap-3 rounded-2xl p-6 text-base font-bold text-aura-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-aura-accent-dark [&::-webkit-details-marker]:hidden">
                    <span aria-hidden="true" className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${condition.chip}`}>
                      <condition.icon className="h-5 w-5" />
                    </span>
                    {condition.name}
                    <ChevronDown
                      aria-hidden="true"
                      className="ml-auto h-4 w-4 shrink-0 text-aura-muted transition-transform duration-300 group-open:rotate-180"
                    />
                  </summary>
                  <div className="grid transition-[grid-template-rows] duration-300 ease-out [grid-template-rows:0fr] group-open:[grid-template-rows:1fr]">
                    <p className="m-0 overflow-hidden px-6 pb-6 text-sm leading-relaxed text-aura-muted">{condition.desc}</p>
                  </div>
                </details>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Two-tier pipeline */}
      <section className="bg-aura-bg-alt px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-[1.65rem] font-bold tracking-tight text-aura-text md:text-[2rem]">Two-Tier Gated Classification Pipeline</h2>
          <p className="mt-2 text-aura-muted">Rather than one model guessing across every condition at once, screening runs through two purpose-built stages in sequence.</p>
          <motion.div variants={staggerContainer} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.3 }} className="mt-8 grid gap-6 md:grid-cols-2">
            <motion.div variants={staggerItem} whileHover={cardHover.whileHover} whileTap={cardHover.whileTap} className="rounded-2xl border border-aura-border-soft bg-aura-bg-card p-8 shadow-aura-card">
              <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-aura-accent-light to-aura-accent-dark shadow-aura-sm">
                <Check className="h-7 w-7 text-white" />
              </div>
              <span className="inline-block rounded-full bg-aura-accent-dark px-3 py-1 text-[0.7rem] font-bold tracking-wider text-white">TIER 1</span>
              <h3 className="mt-4 text-lg font-bold text-aura-text">TB Gatekeeper</h3>
              <p className="mt-2 text-sm leading-relaxed text-aura-muted">A focused binary check on a short 0.34s window of the cough, screening specifically for tuberculosis. A positive result halts the pipeline and returns a TB alert immediately.</p>
            </motion.div>
            <motion.div variants={staggerItem} whileHover={cardHover.whileHover} whileTap={cardHover.whileTap} className="rounded-2xl border border-aura-border-soft bg-aura-bg-card p-8 shadow-aura-card">
              <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-aura-accent-light to-aura-accent-dark shadow-aura-sm">
                <Mic className="h-7 w-7 text-white" />
              </div>
              <span className="inline-block rounded-full bg-aura-accent-dark px-3 py-1 text-[0.7rem] font-bold tracking-wider text-white">TIER 2</span>
              <h3 className="mt-4 text-lg font-bold text-aura-text">Respiratory Classifier</h3>
              <p className="mt-2 text-sm leading-relaxed text-aura-muted">If TB is ruled out, a second model analyzes a wider 2.0s window to classify the cough as COPD, Healthy, or Pneumonia.</p>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Signal Processing */}
      <section className="px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <div className="grid items-center gap-12 md:grid-cols-2">
            <div>
              <h2 className="text-[1.65rem] font-bold tracking-tight text-aura-text md:text-[2rem]">Signal Processing</h2>
              <p className="mt-3 text-aura-muted leading-relaxed">Raw audio is standardized to 16 kHz mono, passed through a low-pass filter to reduce high-frequency noise, then converted into a Log-Mel Spectrogram — the same representation used for both tiers, sliced to a different time window for each.</p>
            </div>
            <motion.table variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true }} className="w-full border-separate overflow-hidden rounded-2xl border border-aura-border-soft bg-aura-bg-card shadow-aura-card">
              <thead>
                <tr>
                  <th className="bg-aura-bg-alt px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-aura-text">Step</th>
                  <th className="bg-aura-bg-alt px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-aura-text">Detail</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Resampling", "16,000 Hz, mono"],
                  ["Low-pass filter", "5th-order Butterworth, 3,000 Hz cutoff"],
                  ["Spectrogram", "64 Mel bins, resized for ResNet18"],
                  ["Tier 1 window", "0.34 s, peak-centered"],
                  ["Tier 2 window", "2.0 s, peak-centered"],
                ].map(([step, detail]) => (
                  <tr key={step} className="group">
                    <td className="border-b border-aura-border-soft px-6 py-4 text-sm font-medium text-aura-text">{step}</td>
                    <td className="border-b border-aura-border-soft px-6 py-4 text-sm text-aura-muted group-last:border-b-0">{detail}</td>
                  </tr>
                ))}
              </tbody>
            </motion.table>
          </div>
        </div>
      </section>

    </div>
  )
}
