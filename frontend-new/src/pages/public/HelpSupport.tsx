import { motion, AnimatePresence, useReducedMotion, type Variants } from "framer-motion"
import { ArrowRight, BookOpen, ChevronDown, LifeBuoy, MessageSquare, ShieldCheck, Send } from "lucide-react"
import { PageHero } from "@/components/PageHero"
import { PageShell } from "@/components/PageShell"
import { SectionHeading } from "@/components/SectionHeading"
import { Reveal } from "@/components/Reveal"
import { EASE_OUT, VIEWPORT } from "@/lib/fine-motion"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { useState } from "react"
import { toast } from "sonner"

/* Answers are structured, not one string.

   They used to be single strings containing literal "1) " and "• " markers,
   rendered as one <p>. On a phone that produced a wall of text where the
   numbers ran into the previous step mid-sentence and the bullets ran together
   -- "1) Connect your digital stethoscope via USB or Bluetooth. 2) Open the
   Screening page" is one visual line, so the reader cannot find step 3.

   The markup now matches the content: an <ol> for steps, a <ul> for points,
   one <li> each. Screen readers get real list semantics and announce position,
   which they could not before because the numbers were just characters. */
type FaqAnswerPart =
  | { type: "text"; body: string }
  | { type: "ordered"; items: string[] }
  | { type: "unordered"; items: string[] }

type FaqItem = { q: string; a: FaqAnswerPart[] }
type FaqCategory = { id: string; label: string; icon: typeof ShieldCheck; items: FaqItem[] }

const SUPPORT_EMAIL = "supportauradx@gmail.com"

/** Keeps the common shape readable in source: ["text", "hello"] not {type,body}. */
const text = (body: string): FaqAnswerPart => ({ type: "text", body })
const ordered = (...items: string[]): FaqAnswerPart => ({ type: "ordered", items })
const unordered = (...items: string[]): FaqAnswerPart => ({ type: "unordered", items })

const categories: FaqCategory[] = [
  {
    id: "general",
    label: "General Questions",
    icon: ShieldCheck,
    items: [
      {
        q: "What is AURA-Dx?",
        a: [
          text(
            "AURA-Dx (Acoustic Unit for Respiratory Assessment) is a web-based screening-support tool that uses AI to analyze breathing sounds for signs of COPD, pneumonia, and healthy lungs."
          ),
          text(
            "It was developed as a BS Computer Engineering thesis project at the University of Rizal System — Morong Campus. It is a research prototype, not a certified medical device."
          ),
        ],
      },
      {
        q: "Is AURA-Dx a medical diagnosis?",
        a: [
          text("No. AURA-Dx provides screening support only — it gives a classification (COPD, Pneumonia, or Healthy) with a confidence score."),
          text(
            "This is a suggested next step for clinical review, not a diagnosis. Always consult a licensed physician for medical decisions."
          ),
        ],
      },
      {
        q: "Is my data private?",
        a: [
          text(
            "Yes. No audio is captured without your explicit consent for each session, and data is encrypted in transit and at rest."
          ),
          unordered(
            "You can request export or deletion at any time.",
            "We comply with the Data Privacy Act of 2012 (R.A. 10173).",
            "No data is sold or shared with third parties."
          ),
        ],
      },
      {
        q: "What conditions does AURA-Dx screen for?",
        a: [
          text("Three classes:"),
          unordered("Healthy", "COPD", "Pneumonia"),
          text(
            "The model outputs a confidence score for each, and low-confidence results are routed to manual review."
          ),
        ],
      },
    ],
  },
  {
    id: "screening",
    label: "Screening Process",
    icon: BookOpen,
    items: [
      {
        q: "How do I capture a breathing sample?",
        a: [
          ordered(
            "Connect your digital stethoscope using a wired connection.",
            "Open the Screening page and pair the device.",
            "Work through the five suggested sites in order — anterior right, anterior left, posterior right, posterior left, then trachea.",
            "Press Capture and have the patient breathe normally for 5–8 full breaths at each site (roughly 15–25 seconds).",
            "Review the waveforms, then Submit."
          ),
          text("Consent is required before capture starts."),
        ],
      },
      {
        q: "What are the tips for a good recording?",
        a: [
          unordered(
            "Quiet room — no fans, TV or background conversation.",
            "Good skin contact with the stethoscope diaphragm.",
            "Use the five standard sites rather than repeating one spot.",
            "Patient sits upright and breathes naturally, not deliberately deep.",
            "Avoid clothing rustle and patient movement.",
            "Capture 5–8 full breaths per site, about 15–25 seconds."
          ),
          text("Anything under 10 seconds has too few breaths to analyse."),
        ],
      },
      {
        q: "What do the results mean?",
        a: [
          text(
            "Shows classification (COPD, Pneumonia, or Healthy) with a confidence score and per-class probabilities."
          ),
          text(
            "Low confidence (under 70%) flags the result for clinician review. This is screening support — always discuss with your doctor."
          ),
        ],
      },
      {
        q: "Which digital stethoscopes are compatible?",
        a: [
          text(
            "Any digital stethoscope that your device recognises as a microphone. Most modern models qualify — Eko, Thinklabs, 3M Littmann CORE, Stemoscope and similar."
          ),
          unordered(
            "Use a wired connection. Plug it in and it appears as an audio input straight away.",
            "A Bluetooth stethoscope works only if you have already paired it in your device's settings — AURA-Dx cannot pair it for you.",
            "It must output standard PCM audio at 16–48 kHz.",
            "If you are unsure whether yours is supported, contact support with the model number."
          ),
        ],
      },
      {
        q: "What are the standard auscultation points I should capture?",
        a: [
          text("Five sites, covering both axes and the midline:"),
          unordered(
            "Anterior right — 3rd right intercostal space, mid-clavicular line.",
            "Anterior left — 3rd left intercostal space, mid-clavicular line.",
            "Posterior right — between the right shoulder blade and the spine.",
            "Posterior left — between the left shoulder blade and the spine.",
            "Trachea — centre of the neck, just below the Adam’s apple. Take this one last."
          ),
          text(
            "Five separate sites is the point, not five recordings of one spot. The takes are combined, so five takes from the same place tell the model nothing the first one did not."
          ),
          text("The sites are a suggestion — record wherever is clinically right."),
        ],
      },
    ],
  },
  {
    id: "technical",
    label: "Technical Help",
    icon: MessageSquare,
    items: [
      {
        q: "My digital stethoscope isn't detected. What should I do?",
        a: [
          ordered(
            "Check the wired connection — make sure the cable is firmly seated at both ends.",
            "Allow device permission in the browser (the lock icon in the address bar).",
            "Make sure you are on HTTPS — device APIs require a secure origin.",
            "Use a supported browser: Chrome 100+, Edge 100+, Firefox 98+, Safari 15+.",
            "Close any other app that may be holding the device.",
            "Test the device in your OS sound settings first.",
            "Check that manufacturer drivers and firmware are up to date."
          ),
        ],
      },
      {
        q: "Which browsers are supported?",
        a: [
          unordered(
            "Chrome 100+",
            "Edge 100+",
            "Firefox 98+",
            "Safari 15+ (iOS 15+ / macOS 12+)"
          ),
          text(
            "Any current browser works — AURA-Dx uses the standard microphone input, which all of them provide. Internet Explorer and legacy Edge are not supported."
          ),
        ],
      },
      {
        q: "Can I use AURA-Dx on a tablet or phone with my digital stethoscope?",
        a: [
          text(
            "Yes. You will need a suitable adapter to plug the stethoscope into the tablet or phone."
          ),
          unordered(
            "Check the adapter supports audio, not just charging or data.",
            "The responsive interface works on all screen sizes.",
            "For best results, use a tablet in landscape during patient exams."
          ),
        ],
      },
      {
        q: "The page won't load / shows a blank screen.",
        a: [
          ordered(
            "Hard refresh — Ctrl/Cmd + Shift + R.",
            "Clear the cache.",
            "Disable extensions (ad blockers, privacy tools).",
            "Try an incognito or private window.",
            "Check the browser console (F12) for errors.",
            "If the backend is down, wait and retry."
          ),
        ],
      },
    ],
  },
]

export function PublicHelpSupport() {
  const reduceMotion = useReducedMotion()
  const [openItems, setOpenItems] = useState<Set<string>>(new Set())

  function makeKey(catId: string, idx: number) {
    return `${catId}-${idx}`
  }

  function toggleItem(catId: string, idx: number) {
    const key = makeKey(catId, idx)
    setOpenItems((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <PageShell>
      <PageHero title="Help & Support">
        Find answers to common questions, learn how screening works, or contact our team directly.
      </PageHero>

      {/* FAQ Sections - 3 Column Layout */}
      <div className="mx-auto max-w-7xl mt-10 md:mt-16 px-4">
        <div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {categories.map((cat, catIndex) => (
            <Reveal key={cat.id} delay={0.1 + catIndex * 0.08} className="stagger-item">
              <Card className="border-aura-border-soft bg-white h-full flex flex-col">
                <CardHeader className="border-b border-aura-border-soft pb-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-aura-mint-soft text-aura-forest">
                      <cat.icon className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <CardTitle className="text-lg font-semibold">{cat.label}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="pt-4 pb-0 flex-1">
                  <ul className="m-0 list-none divide-y divide-aura-border-soft p-0">
                    {cat.items.map((faq, idx) => {
                      const key = `${cat.id}-${idx}`
                      const open = openItems.has(key)
                      const itemId = `faq-${cat.id}-${idx}`
                      return (
                        <li key={itemId} className="group">
                          <button
                            type="button"
                            onClick={() => toggleItem(cat.id, idx)}
                            aria-expanded={open}
                            aria-controls={itemId}
                            id={`${itemId}-btn`}
                            className="flex w-full items-center justify-between gap-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-accent-dark focus-visible:ring-offset-2"
                          >
                            <span className="text-sm font-medium text-aura-text pr-4 leading-relaxed">{faq.q}</span>
                            <ChevronDown
                              className={cn(
                                "h-4 w-4 shrink-0 text-aura-muted transition-transform duration-300",
                                open && "rotate-180"
                              )}
                              aria-hidden="true"
                            />
                          </button>
                          <AnimatePresence>
                            {open && (
                              <div
                                id={itemId}
                                role="region"
                                aria-labelledby={`${itemId}-btn`}
                                className="animate-accordion-down"
                              >
                                {/* Answer body.

                                  One column, generous rhythm. `space-y-3`
                                  between blocks and `gap-2.5` inside a list is
                                  what makes it read as a list rather than a
                                  paragraph -- on a 375px column the difference
                                  between 4px and 10px of separation is the
                                  difference between scannable and a wall.

                                  Markers are drawn, not native. `list-none`
                                  plus an explicit marker span is used because
                                  native `1.` / `•` markers sit in the gutter
                                  that `pl-6` reserves, which on a narrow column
                                  steals a fifth of the measure for a single
                                  digit. Here the number is a fixed 20px disc
                                  and the text starts immediately after it, so
                                  wrapped lines align under the text and not
                                  under the marker.

                                  The <ol>/<ul>/<li> elements are still what
                                  carries the semantics -- a screen reader
                                  announces "1 of 5" regardless of the visual
                                  treatment, which the old inline "1) " string
                                  could not do. */}
                                <div className="space-y-3 pt-3 pb-4 pr-4 text-sm leading-relaxed text-aura-muted">
                                  {faq.a.map((part, pi) => {
                                    if (part.type === "text") {
                                      return <p key={pi} className="m-0">{part.body}</p>
                                    }
                                    if (part.type === "ordered") {
                                      return (
                                        <ol key={pi} className="m-0 list-none space-y-2 p-0">
                                          {part.items.map((item, ii) => (
                                            <li key={ii} className="flex gap-2.5">
                                              <span
                                                aria-hidden="true"
                                                className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-aura-mint-soft text-[0.7rem] font-semibold tabular-nums text-aura-forest"
                                              >
                                                {ii + 1}
                                              </span>
                                              <span className="min-w-0 flex-1">{item}</span>
                                            </li>
                                          ))}
                                        </ol>
                                      )
                                    }
                                    return (
                                      <ul key={pi} className="m-0 list-none space-y-2 p-0">
                                        {part.items.map((item, ii) => (
                                          <li key={ii} className="flex gap-2.5">
                                            <span
                                              aria-hidden="true"
                                              className="mt-[0.5em] h-1.5 w-1.5 shrink-0 rounded-full bg-aura-accent"
                                            />
                                            <span className="min-w-0 flex-1">{item}</span>
                                          </li>
                                        ))}
                                      </ul>
                                    )
                                  })}
                                </div>
                              </div>
                            )}
                          </AnimatePresence>
                        </li>
                      )
                    })}
                  </ul>
                </CardContent>
              </Card>
            </Reveal>
          ))}
        </div>
      </div>

      {/* Quick contact info: centered at bottom in a distinct box */}
      <div className="flex justify-center mt-20 md:mt-28 pb-12 md:pb-20">
        <Reveal delay={0.2} className="w-full max-w-md">
          <Card className="bg-aura-surface border-2 border-aura-border shadow-aura-md">
            <CardHeader className="text-center border-b border-aura-border-soft">
              <div className="flex items-center justify-center gap-3 mb-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-aura-mint-soft text-aura-forest">
                  <LifeBuoy className="h-5 w-5" aria-hidden="true" />
                </div>
                <CardTitle className="text-lg font-semibold">Other ways to reach us</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-center pt-4">
              <a href={`mailto:${SUPPORT_EMAIL}`} className="flex items-center justify-center gap-3 text-sm text-aura-text hover-tap:text-aura-forest transition-colors">
                <Send className="h-5 w-5 text-aura-forest" aria-hidden="true" />
                <span>{SUPPORT_EMAIL}</span>
              </a>
              <p className="text-sm text-aura-muted">University of Rizal System — Morong Campus, BS Computer Engineering</p>
            </CardContent>
          </Card>
        </Reveal>
      </div>
    </PageShell>
  )
}