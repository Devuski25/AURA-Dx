import { useState } from "react"
import { Link } from "react-router-dom"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { ArrowRight, FileAudio, Mic, ShieldCheck, Stethoscope, type LucideIcon } from "lucide-react"
import { spring } from "@/lib/motion"
import { EASE_OUT } from "@/lib/fine-motion"
import { useHeroParallax } from "@/lib/useHeroParallax"
import { BreathWave } from "@/components/BreathWave"
import { PageShell } from "@/components/PageShell"
import { Reveal, Stagger, StaggerItem, DrawRule } from "@/components/Reveal"
import { SectionHeading } from "@/components/SectionHeading"
import { SplitHeading } from "@/components/SplitHeading"
import WebdesHero from "@/assets/public/webdes.png"

const STEPS = [
  { title: "Give consent", desc: "Nothing records until explicit, informed consent is given." },
  { title: "Record or upload", desc: "Breathe into your device microphone, or upload an existing WAV file." },
  { title: "Get guidance", desc: "A clinician reviews the result and the suggested next step with you." },
]

const FEATURES: { icon: LucideIcon; title: string; desc: string }[] = [
  { icon: Mic, title: "Browser microphone", desc: "Record breathing audio directly in the portal — no extra hardware needed." },
  { icon: FileAudio, title: "WAV upload", desc: "Analyze an existing recording from any device." },
  { icon: Stethoscope, title: "Doctor and nurse portal", desc: "Review the spectrogram, confidence score, and a suggested next step for every session." },
]

const FAQS = [
  {
    q: "Is an AURA-Dx result a medical diagnosis?",
    a: "No. AURA-Dx is a screening-support tool, not a certified diagnostic device. A result is a suggested next step, not a diagnosis, and should not replace evaluation by a licensed physician.",
  },
  {
    q: "What happens to my recording and results?",
    a: "Nothing is captured without your explicit consent. Once consent is given, your recording and result are stored so you or a clinician can review them later. You can request export or deletion at any time from the Legal & Privacy page.",
  },
  {
    q: "Who can see my screening history?",
    a: "Only you and logged-in clinicians can review screening results. The full Screening Dashboard, which lists results across patients, is restricted to approved doctor/nurse accounts.",
  },
  {
    q: "What conditions does AURA-Dx screen for?",
    a: "Three classes: Healthy, COPD, and Pneumonia, using the acoustic analysis pipeline described above.",
  },
]

/* Buttons: a colour sweeps in from the left on hover, and the button presses in on click. */
const SMOOTH = "ease-[cubic-bezier(0.22,1,0.36,1)]"
const BTN =
  "relative isolate overflow-hidden transition-[transform,color,box-shadow] duration-300 active:scale-[0.97] before:absolute before:inset-0 before:-z-10 before:-translate-x-full before:transition-transform before:duration-500 before:ease-[cubic-bezier(0.22,1,0.36,1)] hover:before:translate-x-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"

export function Home() {
  const reduceMotion = useReducedMotion()
  const { ref, style } = useHeroParallax()
  const [openFaq, setOpenFaq] = useState<number | null>(0)

  return (
    <PageShell>
      {/* Hero */}
      <section ref={ref} className="relative overflow-hidden bg-gradient-to-br from-aura-hero-from via-aura-hero-via to-aura-hero-to">
        <div aria-hidden="true" className="absolute inset-0 aura-dots opacity-20" />
        <motion.div style={style} className="relative mx-auto grid max-w-7xl items-center gap-10 px-6 pb-36 pt-14 md:grid-cols-[1.15fr_0.85fr] md:pb-44 md:pt-20">
          <div className="relative z-10">
            <Reveal as="p" delay={0.1} y={12} className="text-sm font-semibold text-white/70">
              AURA-Dx, the Acoustic Unit for Respiratory Assessment
            </Reveal>
            <SplitHeading
              text="Screen breathing sounds for COPD and pneumonia"
              delay={0.25}
              className="mt-4 max-w-[20ch] font-display text-[2.1rem] font-bold leading-[1.04] tracking-[-0.02em] text-white md:text-[3.6rem]"
            />
            <Reveal as="p" delay={0.9} className="mt-6 max-w-[48ch] text-[1.05rem] leading-relaxed text-white/75 md:text-lg">
              Record a short breathing sample and AURA-Dx flags possible findings for a clinician to review. Nothing is recorded without your consent.
            </Reveal>
            <Reveal delay={1.05} className="mt-9 flex flex-wrap items-center gap-4">
              <Link
                to="/login"
                className={`${BTN} group inline-flex items-center gap-2.5 rounded-full bg-white px-8 py-4 text-sm font-bold text-aura-forest no-underline before:bg-aura-mint-soft hover:shadow-xl hover:shadow-black/20 focus-visible:ring-white focus-visible:ring-offset-aura-forest`}
              >
                Log in
                <ArrowRight className={`h-4 w-4 transition-transform duration-500 ${SMOOTH} group-hover:translate-x-1.5`} aria-hidden="true" />
              </Link>
              <Link
                to="/about"
                className={`${BTN} rounded-full border border-white/25 px-6 py-4 text-sm font-semibold text-white no-underline before:bg-white/10 focus-visible:ring-white focus-visible:ring-offset-aura-forest`}
              >
                See how it works
              </Link>
            </Reveal>
            <Reveal as="p" delay={1.2} y={8} className="mt-6 text-sm text-white/70">Screening support only. Not a medical diagnosis.</Reveal>
          </div>

          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 48, scale: 0.94, filter: "blur(10px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)", transitionEnd: { filter: "none" } }}
            transition={{ duration: 1.4, ease: EASE_OUT, delay: 0.5 }}
            className="hidden md:block"
          >
            {/* slow idle float once it has landed */}
            <motion.div
              animate={reduceMotion ? undefined : { y: [0, -9, 0] }}
              transition={{ duration: 7, ease: "easeInOut", repeat: Infinity, delay: 2.2 }}
            >
              <img src={WebdesHero} alt="AURA-Dx respiratory screening" className="block w-full rounded-2xl object-contain" loading="eager" decoding="async" width={640} height={480} />
            </motion.div>
          </motion.div>
        </motion.div>
        <BreathWave className="absolute inset-x-0 bottom-0 h-24 w-full md:h-32" />
      </section>

      {/* Steps */}
      <section className="bg-white px-6 py-16 md:py-24">
        <div className="mx-auto max-w-6xl">
          <SectionHeading>How screening works</SectionHeading>
          <Reveal as="p" delay={0.1} className="mt-3 text-aura-muted">Three steps, under a minute of your time.</Reveal>
          <Stagger as="ol" className="m-0 mt-10 grid list-none gap-8 p-0 md:grid-cols-3 md:gap-10">
            {STEPS.map((step, i) => (
              <StaggerItem as="li" key={step.title} className="group">
                <DrawRule className="h-0.5 bg-aura-forest" delay={0.2 + i * 0.12} />
                <span aria-hidden="true" className={`mt-5 inline-block font-display text-4xl font-bold tabular-nums text-aura-accent-dark transition-transform duration-500 ${SMOOTH} group-hover:translate-x-2`}>{i + 1}</span>
                <h3 className="mt-3 text-base font-bold text-aura-text">{step.title}</h3>
                <p className="mt-2 max-w-[34ch] text-sm leading-relaxed text-aura-muted">{step.desc}</p>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* Clinic */}
      <section className="bg-aura-mint-wash px-6 py-16 md:py-24">
        <div className="mx-auto grid max-w-6xl items-start gap-12 md:grid-cols-2 md:gap-16">
          <div>
            <SectionHeading>Built for the clinic</SectionHeading>
            <Reveal as="p" delay={0.1} className="mt-5 max-w-[42ch] text-[1.05rem] leading-relaxed text-aura-muted">
              No special hardware needed — AURA-Dx runs in any modern browser. Clinicians capture a breathing sample and get structured, reviewable results in seconds.
            </Reveal>
            <Reveal delay={0.2}>
              <Link
                to="/login"
                className={`${BTN} group mt-8 inline-flex items-center gap-2.5 rounded-full bg-aura-forest px-7 py-3.5 text-sm font-bold text-white no-underline before:bg-black/20 hover:shadow-lg hover:shadow-aura-forest/30 focus-visible:ring-aura-forest`}
              >
                Log in
                <ArrowRight className={`h-4 w-4 transition-transform duration-500 ${SMOOTH} group-hover:translate-x-1.5`} aria-hidden="true" />
              </Link>
            </Reveal>
          </div>
          <Stagger as="ul" className="m-0 list-none divide-y divide-aura-border border-y border-aura-border p-0">
            {FEATURES.map((f) => (
              <StaggerItem as="li" key={f.title} className="group flex items-start gap-4 py-5">
                <span aria-hidden="true" className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white text-aura-forest transition-all duration-500 ${SMOOTH} group-hover:scale-110 group-hover:bg-aura-forest group-hover:text-white`}>
                  <f.icon className="h-5 w-5" />
                </span>
                <div className={`transition-transform duration-500 ${SMOOTH} group-hover:translate-x-1`}>
                  <h3 className="text-sm font-bold text-aura-text">{f.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-aura-muted">{f.desc}</p>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-white px-6 py-16 md:py-24">
        <div className="mx-auto max-w-3xl">
          <SectionHeading>Common questions</SectionHeading>
          <Stagger as="ul" className="m-0 mt-8 list-none divide-y divide-aura-border border-y border-aura-border p-0">
            {FAQS.map((faq, i) => {
              const open = openFaq === i
              return (
                <StaggerItem as="li" key={faq.q}>
                  <h3>
                    <button
                      type="button"
                      id={`faq-button-${i}`}
                      onClick={() => setOpenFaq(open ? null : i)}
                      aria-expanded={open}
                      aria-controls={`faq-panel-${i}`}
                      className={`group flex w-full cursor-pointer items-center justify-between gap-4 py-5 text-left text-base font-semibold transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-accent-dark focus-visible:ring-offset-2 ${open ? "text-aura-forest" : "text-aura-text hover:text-aura-forest"}`}
                    >
                      {faq.q}
                      <motion.span
                        animate={{ rotate: open ? 135 : 0, backgroundColor: open ? "var(--color-aura-forest)" : "var(--color-aura-mint-soft)", color: open ? "#ffffff" : "var(--color-aura-accent-dark)" }}
                        transition={reduceMotion ? { duration: 0 } : { duration: 0.5, ease: EASE_OUT }}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-base font-bold"
                        aria-hidden="true"
                      >
                        +
                      </motion.span>
                    </button>
                  </h3>
                  <AnimatePresence initial={false}>
                    {open && (
                      <motion.div
                        key="panel"
                        id={`faq-panel-${i}`}
                        role="region"
                        aria-labelledby={`faq-button-${i}`}
                        initial={reduceMotion ? { height: "auto", opacity: 1 } : { height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={reduceMotion ? { height: "auto", opacity: 0 } : { height: 0, opacity: 0 }}
                        transition={reduceMotion ? { duration: 0 } : { height: { duration: 0.55, ease: EASE_OUT }, opacity: { duration: 0.4, delay: open ? 0.1 : 0 } }}
                        className="overflow-hidden"
                      >
                        <p className="max-w-[62ch] pb-6 pr-11 text-sm leading-relaxed text-aura-legal-text">{faq.a}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </StaggerItem>
              )
            })}
          </Stagger>
        </div>
      </section>

      {/* Consent */}
      <section className="bg-aura-mint-wash px-6 py-14 md:py-20">
        <Reveal className="mx-auto max-w-3xl">
          <aside className="flex items-start gap-5 rounded-r-xl border-l-4 border-aura-accent bg-white p-6 md:p-8">
            <ShieldCheck className="mt-1 h-6 w-6 shrink-0 text-aura-forest" aria-hidden="true" />
            <div>
              <h2 className="font-display text-lg font-bold text-aura-text">Consent first, in line with Philippine law</h2>
              <p className="mt-2 text-sm leading-relaxed text-aura-muted">
                No audio is captured without explicit, informed consent. AURA-Dx follows the Data Privacy Act of 2012 (R.A. 10173) and the Cybercrime Prevention Act of 2012 (R.A. 10175).
              </p>
              <Link
                to="/legal"
                className="group mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-aura-accent-dark underline-offset-4 hover:underline focus-visible:outline-none focus-visible:underline"
              >
                Read the Legal &amp; Privacy page
                <ArrowRight className={`h-4 w-4 transition-transform duration-500 ${SMOOTH} group-hover:translate-x-1.5`} aria-hidden="true" />
              </Link>
            </div>
          </aside>
        </Reveal>
      </section>
    </PageShell>
  )
}
