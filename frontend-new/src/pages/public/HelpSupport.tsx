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

type FaqItem = { q: string; a: string }
type FaqCategory = { id: string; label: string; icon: typeof ShieldCheck; items: FaqItem[] }

const SUPPORT_EMAIL = "support@auradx.xyz"

const categories: FaqCategory[] = [
  {
    id: "general",
    label: "General Questions",
    icon: ShieldCheck,
    items: [
      {
        q: "What is AURA-Dx?",
        a: "AURA-Dx (Acoustic Unit for Respiratory Assessment) is a web-based screening-support tool that uses AI to analyze breathing sounds for signs of COPD, pneumonia, and healthy lungs. It was developed as a BS Computer Engineering thesis project at the University of Rizal System — Morong Campus. It is a research prototype, not a certified medical device.",
      },
      {
        q: "Is AURA-Dx a medical diagnosis?",
        a: "No. AURA-Dx provides screening support only — it gives a classification (COPD, Pneumonia, or Healthy) with a confidence score. This is a suggested next step for clinical review, not a diagnosis. Always consult a licensed physician for medical decisions.",
      },
      {
        q: "Is my data private?",
        a: "Yes. No audio is captured without your explicit consent for each session. Data is encrypted in transit and at rest. You can request export or deletion anytime. We comply with the Data Privacy Act of 2012 (R.A. 10173). No data is sold or shared with third parties.",
      },
      {
        q: "What conditions does AURA-Dx screen for?",
        a: "Three classes: Healthy, COPD, and Pneumonia. The model outputs a confidence score for each, and low-confidence results are routed to manual review.",
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
        a: "1) Connect your compatible digital stethoscope via USB/Bluetooth. 2) Open the Screening page and pair the device. 3) Place the stethoscope on standard auscultation points (posterior bases, anterior bases, lateral). 4) Press Capture and have the patient breathe normally for 1–2 full cycles per point. 5) Review the waveforms, then Submit. Consent is required before capture starts.",
      },
      {
        q: "What are the tips for a good recording?",
        a: "• Quiet room (no fans, TV, background conversation). • Ensure good skin contact with stethoscope diaphragm. • Standard auscultation points: posterior lower lobes, anterior bases, right middle lobe, lingula. • Patient sits upright, breathes naturally through mouth. • Avoid clothing rustle or patient movement. • Capture 1–2 full breathing cycles per point.",
      },
      {
        q: "What do the results mean?",
        a: "Shows classification (COPD, Pneumonia, or Healthy) with a confidence score and per-class probabilities. Low confidence (< 70%) flags the result for clinician review. This is screening support — always discuss with your doctor.",
      },
      {
        q: "Which digital stethoscopes are compatible?",
        a: "AURA-Dx works with any digital stethoscope that supports Web USB or Web Bluetooth API (most modern FDA-cleared devices: Eko, Thinklabs, 3M Littmann CORE, Stemoscope, etc.). The device must output standard PCM audio at 16–48 kHz. Check your device specs for 'Web USB' or 'Bluetooth LE Audio' support. If unsure, contact support with your model number.",
      },
      {
        q: "What are the standard auscultation points I should capture?",
        a: "Capture 1–2 full breathing cycles at each standard point: Posterior — lower lobes (bilateral), right middle lobe, lingula. Anterior — upper lobes (bilateral), right middle lobe, lingula. Lateral — lower lobes (bilateral). Minimum: 6 points (posterior bases + anterior bases). More points = better classification confidence.",
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
        a: "1) Check connection: USB cable firmly seated, or Bluetooth paired in OS settings. 2) Allow device permission in browser (lock icon in address bar). 4) Use HTTPS (required for device APIs). 5) Use Chrome 100+, Edge 100+, Firefox 98+, Safari 15+. 6) Close other apps using the device. 6) Test device in OS sound settings first. 7) Check manufacturer drivers/firmware are up to date.",
      },
      {
        q: "Which browsers are supported?",
        a: "Chrome 100+, Edge 100+, Firefox 98+, Safari 15+ (iOS 15+/macOS 12+). Requires Web USB API or Web Bluetooth API support. Internet Explorer and legacy Edge are not supported.",
      },
      {
        q: "Can I use AURA-Dx on a tablet or phone with my digital stethoscope?",
        a: "Yes. Chrome/Edge on Android and Safari on iOS/iPadOS support Web USB and Web Bluetooth APIs. Pair your stethoscope via Bluetooth or connect via USB-C/OTG adapter. The responsive interface works on all screen sizes. For best results, use a tablet in landscape orientation during patient exams.",
      },
      {
        q: "The page won't load / shows a blank screen.",
        a: "Try: 1) Hard refresh (Ctrl/Cmd+Shift+R). 2) Clear cache. 3) Disable extensions (ad blockers, privacy tools). 4) Try incognito/private window. 5) Check browser console (F12) for errors. 6) If backend is down, wait and retry.",
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
                                <p className="pt-3 pb-4 pr-4 text-sm leading-relaxed text-aura-muted">{faq.a}</p>
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

      {/* Quick contact info - centered at bottom in a distinct box */}
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
              <a href={`mailto:${SUPPORT_EMAIL}`} className="flex items-center justify-center gap-3 text-sm text-aura-text hover:text-aura-forest transition-colors">
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