import { useRef, useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
  type Variants,
} from "framer-motion"
import {
  ArrowRight,
  ChevronRight,
  ClipboardCheck,
  FileAudio,
  Mic,
  ShieldCheck,
  Stethoscope,
  Zap,
  type LucideIcon,
} from "lucide-react"
import { fadeUp, spring, staggerContainer, staggerItem } from "@/lib/motion"
import WebdesHero from "@/assets/public/webdes.png"

/* ---------- Local interactive helpers ---------- */

function SectionHeading({ children, centered }: { children: ReactNode; centered?: boolean }) {
  return (
    <div className={centered ? "text-center" : ""}>
      <h2 className="m-0 font-display text-[1.65rem] font-bold tracking-tight text-aura-text md:text-[2rem]">{children}</h2>
      <motion.span
        aria-hidden="true"
        initial={{ scaleX: 0 }}
        whileInView={{ scaleX: 1 }}
        viewport={{ once: true }}
        transition={{ ...spring.gentle, delay: 0.15 }}
        className={`mt-3 block h-[3px] w-14 origin-left rounded-full bg-gradient-to-r from-aura-accent to-aura-mint ${centered ? "mx-auto" : ""}`}
      />
    </div>
  )
}

/* ---------- Content data ---------- */

const STEPS: { icon: LucideIcon; title: string; desc: string }[] = [
  { icon: ClipboardCheck, title: "Give consent", desc: "Nothing records until explicit, informed consent is given." },
  { icon: Mic, title: "Record or upload", desc: "Cough into your device microphone, or upload an existing WAV file." },
  { icon: Stethoscope, title: "Get guidance", desc: "A clinician reviews the result and the suggested next step with you." },
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
    a: "Four classes: Healthy, COPD, Pneumonia, and Tuberculosis, using the two-tier gated pipeline described above.",
  },
]

/* ---------- Page ---------- */

export function Home() {
  const reduceMotion = useReducedMotion()
  const heroRef = useRef<HTMLDivElement | null>(null)
  const [openFaq, setOpenFaq] = useState<number | null>(0)

  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] })
  const heroImgY = useTransform(scrollYProgress, [0, 1], [0, 50])
  const heroFade = useTransform(scrollYProgress, [0, 0.85], [1, 0.15])
  const parallaxEnabled = !reduceMotion

  return (
    <div>
      {/* ─── Hero ─── */}
      <section ref={heroRef} className="relative overflow-hidden bg-gradient-to-br from-[#0a352e] via-[#0d4a3f] to-aura-forest">
        {/* Decorative grid dots */}
        <div aria-hidden="true" className="absolute inset-0 aura-dots opacity-40" />
        {/* Decorative glow orbs */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute -left-32 top-1/4 h-96 w-96 rounded-full bg-aura-accent/10 blur-[100px]" />
          <div className="absolute -right-20 bottom-0 h-72 w-72 rounded-full bg-aura-mint/10 blur-[80px]" />
        </div>

        <div className="relative mx-auto grid max-w-7xl items-center gap-8 px-6 md:grid-cols-[1.2fr_0.8fr] md:py-0">
          {/* Text */}
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring.gentle, delay: 0.1 }}
            className="relative z-10 py-14 md:py-24"
          >
            <motion.span
              initial={reduceMotion ? false : { opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ ...spring.gentle, delay: 0.05 }}
              className="mb-6 inline-flex items-center gap-2.5 rounded-full border border-white/15 bg-white/8 px-4 py-2 text-xs font-semibold tracking-wide text-white/75 backdrop-blur-sm"
            >
              <span aria-hidden="true" className="inline-block h-2 w-2 animate-pulse rounded-full bg-aura-accent" />
              Acoustic Unit for Respiratory Analysis
            </motion.span>
            <h1 className="m-0 max-w-[18ch] break-words font-display text-[2.1rem] font-bold leading-[1.1] tracking-tight text-white md:max-w-[20ch] md:text-[3.2rem] md:leading-[1.06]">
              For a Better State of Respiratory Health.
            </h1>
            <p className="mt-6 max-w-[44ch] text-[1.05rem] leading-relaxed text-white/70 md:text-lg">
              Screen for tuberculosis, COPD, and pneumonia from a single cough — powered by a two-tier AI pipeline, reviewed by a clinician.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <motion.div whileHover={reduceMotion ? undefined : { scale: 1.04 }} whileTap={reduceMotion ? undefined : { scale: 0.97 }} transition={spring.snappy}>
                <Link
                  to="/login"
                  className="group inline-flex items-center gap-2.5 rounded-full bg-white px-8 py-4 text-sm font-bold text-aura-forest shadow-xl shadow-black/10 transition-all duration-200 hover:bg-white/95 hover:shadow-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-aura-forest"
                >
                  Login to System
                  <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" aria-hidden="true" />
                </Link>
              </motion.div>
              <Link
                to="/about"
                className="group inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-6 py-4 text-sm font-semibold text-white/90 no-underline backdrop-blur-sm transition-all duration-200 hover:border-white/35 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-aura-forest"
              >
                See how it works
                <ChevronRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
            </div>
          </motion.div>

          {/* Image */}
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, x: 40, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            transition={{ ...spring.gentle, delay: 0.3 }}
            className="relative hidden md:block"
          >
            <motion.div style={parallaxEnabled ? { y: heroImgY, opacity: heroFade } : undefined}>
              <div className="relative">
                <div className="absolute -inset-4 rounded-3xl bg-gradient-to-br from-aura-accent/15 to-aura-mint/10 blur-2xl" />
                <img
                  src={WebdesHero}
                  alt="AURA-Dx respiratory screening"
                  className="relative block w-full rounded-2xl object-contain"
                />
              </div>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* ─── Mission Statement ─── */}
      <section className="aura-dots px-6 py-20 md:py-24">
        <div className="mx-auto max-w-4xl text-center">
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={spring.gentle}
          >
            <span className="mb-5 inline-flex items-center gap-2 rounded-full bg-aura-mint-soft px-4 py-1.5 text-xs font-bold tracking-wider text-aura-forest uppercase">
              Our Mission
            </span>
            <p className="m-0 font-display text-[clamp(1.25rem,2.8vw,1.75rem)] font-semibold leading-snug tracking-tight text-aura-text">
              Start living your healthiest life with early respiratory screening.
              AURA-Dx provides world-class AI-assisted analysis in a comforting, consent-first, patient-centered environment.
            </p>
            <Link
              to="/about"
              className="group mt-8 inline-flex items-center gap-2.5 rounded-full bg-aura-forest px-7 py-3.5 text-sm font-bold text-white no-underline shadow-lg shadow-aura-forest/25 transition-all duration-200 hover:bg-green-700 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-aura-forest"
            >
              Explore Our Technology
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" aria-hidden="true" />
            </Link>
          </motion.div>
        </div>
      </section>

      {/* ─── How It Works ─── */}
      <section className="px-6 py-20 md:py-24">
        <div className="mx-auto max-w-6xl">
          <SectionHeading centered>Getting Screened Is Simple</SectionHeading>
          <p className="mt-3 text-center text-aura-muted">Three steps, under a minute of your time.</p>

          {/* Step connector line (desktop) */}
          <div className="relative mt-12">
            <div aria-hidden="true" className="absolute left-[16.67%] right-[16.67%] top-6 hidden h-[2px] bg-gradient-to-r from-aura-accent/20 via-aura-accent/40 to-aura-accent/20 md:block" />

            <motion.ol variants={staggerContainer} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.3 }} className="relative grid list-none gap-6 p-0 md:grid-cols-3">
              {STEPS.map((step, i) => (
                <motion.li
                  key={step.title}
                  variants={staggerItem}
                  className="group relative text-center"
                >
                  {/* Step number circle */}
                  <motion.div
                    initial={reduceMotion ? false : { scale: 0 }}
                    whileInView={{ scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ ...spring.bouncy, delay: 0.15 + i * 0.12 }}
                    className="relative z-10 mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-aura-forest text-sm font-bold text-white shadow-lg shadow-aura-forest/25 tabular-nums"
                  >
                    {i + 1}
                  </motion.div>

                  <div className="rounded-2xl border border-aura-border-soft bg-aura-bg-card p-6 shadow-aura-card transition-all duration-300 hover:-translate-y-1 hover:shadow-aura-card-hover">
                    <span aria-hidden="true" className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-aura-mint-soft text-aura-forest transition-transform duration-300 group-hover:scale-110">
                      <step.icon className="h-6 w-6" />
                    </span>
                    <h3 className="m-0 text-base font-bold text-aura-text">{step.title}</h3>
                    <p className="mt-2 m-0 text-sm leading-relaxed text-aura-muted">{step.desc}</p>
                  </div>
                </motion.li>
              ))}
            </motion.ol>
          </div>
        </div>
      </section>

      {/* ─── Built for the Clinic ─── */}
      <section className="bg-aura-bg-alt px-6 py-20 md:py-24">
        <div className="mx-auto max-w-6xl">
          <div className="grid items-center gap-14 md:grid-cols-2">
            <div>
              <SectionHeading>Built for the Clinic</SectionHeading>
              <p className="mt-5 max-w-[42ch] text-[1.05rem] leading-relaxed text-aura-muted">
                No special hardware needed — AURA-Dx runs in any modern browser. Clinicians capture a cough sample and get structured, reviewable results in seconds.
              </p>
              <Link
                to="/login"
                className="group mt-8 inline-flex items-center gap-2.5 rounded-full bg-aura-forest px-7 py-3.5 text-sm font-bold text-white no-underline shadow-lg shadow-aura-forest/25 transition-all duration-200 hover:bg-green-700 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-aura-forest"
              >
                Try It Now
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" aria-hidden="true" />
              </Link>
            </div>
            <motion.div variants={staggerContainer} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.25 }} className="flex flex-col gap-4">
              {[
                { icon: Mic, title: "Browser Microphone", desc: "Record cough audio directly in the portal — no extra hardware needed." },
                { icon: FileAudio, title: "WAV Upload", desc: "Analyze an existing recording from any device." },
                { icon: Stethoscope, title: "Doctor / Nurse Portal", desc: "Review the spectrogram, confidence score, and a suggested next step for every session." },
              ].map((feature) => (
                <motion.div
                  key={feature.title}
                  variants={staggerItem}
                  className="group flex items-start gap-4 rounded-xl border border-aura-border-soft bg-aura-bg-card p-5 shadow-aura-card transition-all duration-300 hover:-translate-y-0.5 hover:shadow-aura-card-hover"
                >
                  <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-aura-mint-soft text-aura-forest transition-all duration-300 group-hover:scale-110 group-hover:bg-aura-accent/15">
                    <feature.icon className="h-5 w-5" />
                  </span>
                  <div>
                    <h3 className="m-0 text-sm font-bold text-aura-text">{feature.title}</h3>
                    <p className="mt-1 m-0 text-sm leading-relaxed text-aura-muted">{feature.desc}</p>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </div>
      </section>

      {/* ─── FAQ ─── */}
      <section className="bg-aura-bg-alt px-6 py-20 md:py-24">
        <div className="mx-auto max-w-3xl">
          <SectionHeading centered>Frequently Asked Questions</SectionHeading>
          <motion.div variants={staggerContainer} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.1 }} className="mt-10 flex flex-col gap-3">
            {FAQS.map((faq, i) => {
              const open = openFaq === i
              return (
                <motion.div key={faq.q} variants={staggerItem} className="overflow-hidden rounded-2xl border border-aura-border-soft bg-aura-bg-card shadow-aura-card transition-all duration-300 hover:shadow-aura-md">
                  <button
                    type="button"
                    onClick={() => setOpenFaq(open ? null : i)}
                    aria-expanded={open}
                    aria-controls={`faq-panel-${i}`}
                    className="flex w-full cursor-pointer items-center justify-between gap-4 px-6 py-5 text-left text-sm font-semibold text-aura-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-accent-dark focus-visible:ring-offset-2"
                  >
                    {faq.q}
                    <motion.span
                      animate={{ rotate: open ? 45 : 0 }}
                      transition={spring.snappy}
                      className="ml-4 shrink-0 flex h-7 w-7 items-center justify-center rounded-full bg-aura-mint-soft text-sm font-bold text-aura-accent-dark transition-colors duration-200"
                      aria-hidden="true"
                    >
                      +
                    </motion.span>
                  </button>
                  <AnimatePresence initial={false}>
                    {open && (
                      <motion.div
                        key="panel"
                        id={`faq-panel-${i}`}
                        initial={reduceMotion ? { height: "auto", opacity: 1 } : { height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={reduceMotion ? { height: "auto", opacity: 0 } : { height: 0, opacity: 0 }}
                        transition={reduceMotion ? { duration: 0 } : { duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
                        className="overflow-hidden"
                      >
                        <p className="m-0 px-6 pb-6 pr-7 text-sm leading-relaxed text-aura-muted">{faq.a}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )
            })}
          </motion.div>
        </div>
      </section>

      {/* ─── Consent notice ─── */}
      <section className="px-6 py-20 md:py-24">
        <div className="mx-auto max-w-4xl">
          <motion.div variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true }} className="rounded-2xl border border-aura-border bg-gradient-to-br from-aura-bg-alt to-aura-surface-alt p-8 shadow-aura-card md:p-10">
            <div className="flex flex-col gap-5 md:flex-row md:items-start md:gap-6">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-aura-mint-soft shadow-aura-xs">
                <ShieldCheck className="h-7 w-7 text-aura-forest" />
              </div>
              <div>
                <h3 className="m-0 text-lg font-bold text-aura-text">Consent-First, and Compliant with Philippine Law</h3>
                <p className="mt-2 m-0 text-sm leading-relaxed text-aura-muted">No audio is captured without explicit, informed consent. AURA-Dx follows the Data Privacy Act of 2012 (R.A. 10173) and the Cybercrime Prevention Act of 2012 (R.A. 10175).</p>
                <Link to="/legal" className="group mt-4 inline-flex items-center gap-1.5 font-semibold text-aura-accent-dark no-underline transition-colors hover:text-aura-accent focus-visible:outline-none focus-visible:underline">
                  Read the full Legal &amp; Privacy page
                  <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" aria-hidden="true" />
                </Link>
              </div>
            </div>
          </motion.div>
        </div>
      </section>
    </div>
  )
}
