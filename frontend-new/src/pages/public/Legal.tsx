import type { ReactNode } from "react"
import { ShieldAlert } from "lucide-react"
import { PageHero } from "@/components/PageHero"
import { PageShell } from "@/components/PageShell"
import { DrawRule, Reveal, Stagger, StaggerItem } from "@/components/Reveal"

function LegalSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="relative grid gap-4 py-10 md:grid-cols-[13rem_1fr] md:gap-12">
      <DrawRule className="absolute inset-x-0 top-0 h-px bg-aura-border" />
      <h2 id={`${id}-title`} className="font-display text-xl font-bold tracking-tight text-aura-text md:sticky md:top-24 md:self-start">
        {title}
      </h2>
      <Reveal delay={0.1}>{children}</Reveal>
    </section>
  )
}

const LAWS = [
  {
    name: "R.A. 10173: Data Privacy Act of 2012",
    text: "Requires informed consent before collecting personal data, limits use to the stated purpose, and grants data subjects the right to access, correct, and erase their information.",
  },
  {
    name: "R.A. 10175: Cybercrime Prevention Act of 2012",
    text: "Criminalizes unauthorized access to computer systems and data, and illegal interception of data in transit. Applies to audio uploads, portal access, and all data transmitted to and from the system.",
  },
]

const RIGHTS = [
  ["Access", "Request a copy of the screening records and audio associated with your account."],
  ["Export", "Download your screening history and personal data in a portable format at any time."],
  ["Erasure", "Request permanent deletion of your recordings and screening history from the system."],
  ["Withdraw consent", "Decline or withdraw consent for future audio capture without affecting past interactions."],
]

export function Legal() {
  return (
    <PageShell>
      <PageHero title="Legal & patient privacy" centered>
        AURA-Dx processes breathing audio and screening results, which qualify as personal and in some contexts sensitive personal information under Philippine law. This page explains what is collected, why, and what rights you hold over it.
      </PageHero>

      <div className="mx-auto max-w-6xl px-6 py-14 md:py-16">
        <Reveal className="mx-auto mb-14 max-w-3xl">
          <aside
            role="note"
            className="rounded-2xl border border-aura-border bg-aura-mint-wash px-6 py-8 text-center shadow-aura-sm md:px-10 md:py-10"
          >
            <span
              aria-hidden="true"
              className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-white text-aura-forest shadow-aura-xs"
            >
              <ShieldAlert className="h-6 w-6" />
            </span>
            <h2 className="font-display text-xl font-bold tracking-tight text-aura-text md:text-2xl">
              Research prototype, not a medical device
            </h2>
            <p className="mx-auto mt-3 max-w-[58ch] text-sm leading-relaxed text-aura-legal-text md:text-[0.9375rem]">
              AURA-Dx is a thesis-stage research prototype developed at the University of Rizal System — Morong Campus. It demonstrates a screening support workflow and is not a certified diagnostic medical device. Screening results should not replace evaluation by a licensed physician.
            </p>
          </aside>
        </Reveal>

        <LegalSection id="governing-law" title="Governing law">
          <Stagger as="dl" className="m-0 grid gap-8 md:grid-cols-2">
            {LAWS.map((law) => (
              <StaggerItem key={law.name}>
                <dt className="font-display text-base font-bold text-aura-text">{law.name}</dt>
                <dd className="m-0 mt-2 text-sm leading-relaxed text-aura-legal-text">{law.text}</dd>
              </StaggerItem>
            ))}
          </Stagger>
        </LegalSection>

        <LegalSection id="consent" title="Consent">
          <p className="max-w-[68ch] leading-relaxed text-aura-legal-text">
            Every screening session live microphone or uploaded file is gated behind an explicit consent step before any audio is captured or processed. Declining consent stops the flow at that point; no data is retained.
          </p>
        </LegalSection>

        <LegalSection id="rights" title="Your rights">
          <Stagger as="dl" className="m-0 divide-y divide-aura-border border-b border-aura-border">
            {RIGHTS.map(([right, meaning]) => (
              <StaggerItem key={right} className="group grid gap-1 py-4 first:pt-0 sm:grid-cols-[10rem_1fr] sm:gap-6">
                <dt className="text-sm font-semibold text-aura-text transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:translate-x-1">{right}</dt>
                <dd className="m-0 text-sm leading-relaxed text-aura-legal-text">{meaning}</dd>
              </StaggerItem>
            ))}
          </Stagger>
          {/* TODO: say how to make a request (contact or in-app action). The FAQ on Home points people here. */}
        </LegalSection>
      </div>
    </PageShell>
  )
}
