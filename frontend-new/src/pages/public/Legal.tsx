import { ShieldCheck } from "lucide-react"

export function Legal() {
  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-[#0a352e] via-[#0d4a3f] to-aura-forest px-6 py-24 text-center">
        <div aria-hidden="true" className="absolute inset-0 aura-dots opacity-30" />
        <div className="relative z-10 mx-auto max-w-[720px]">
          <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/8 px-4 py-2 text-xs font-semibold tracking-wide text-white/75 backdrop-blur-sm">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Privacy & Compliance
          </span>
          <h1 className="text-[clamp(2rem,4vw,3rem)] font-bold leading-tight tracking-tight text-white">
            Legal &amp; Patient Privacy
          </h1>
          <p className="mx-auto mt-5 max-w-[58ch] text-lg leading-relaxed text-white/70">
            AURA-Dx processes cough audio and screening results, which qualify as personal — and in some contexts sensitive personal — information under Philippine law. This page explains what is collected, why, and what rights you hold over it.
          </p>
        </div>
      </section>

      {/* Governing law */}
      <section className="px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-[1.65rem] font-bold tracking-tight text-aura-text md:text-[2rem]">Governing Law</h2>
          <div className="mt-6 grid gap-5 md:grid-cols-2">
            <div className="rounded-2xl border border-aura-border-soft bg-aura-bg-card p-8 shadow-aura-card transition-all duration-300 hover:shadow-aura-card-hover">
              <h3 className="text-lg font-bold text-aura-text">R.A. 10173 — Data Privacy Act of 2012</h3>
              <p className="mt-2 text-sm leading-relaxed text-aura-muted">Requires informed consent before collecting personal data, limits use to the stated purpose, and grants data subjects the right to access, correct, and erase their information.</p>
            </div>
            <div className="rounded-2xl border border-aura-border-soft bg-aura-bg-card p-8 shadow-aura-card transition-all duration-300 hover:shadow-aura-card-hover">
              <h3 className="text-lg font-bold text-aura-text">R.A. 10175 — Cybercrime Prevention Act of 2012</h3>
              <p className="mt-2 text-sm leading-relaxed text-aura-muted">Criminalizes unauthorized access to computer systems and data, and illegal interception of data in transit. Applies to audio uploads, portal access, and all data transmitted to and from the system.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Consent */}
      <section className="aura-dots bg-aura-bg-alt px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-[1.65rem] font-bold tracking-tight text-aura-text md:text-[2rem]">Consent</h2>
          <p className="mt-3 max-w-[68ch] leading-relaxed text-aura-muted">Every screening session — live microphone or uploaded file — is gated behind an explicit consent step before any audio is captured or processed. Declining consent stops the flow at that point; no data is retained.</p>
        </div>
      </section>

      {/* Data Subject Rights */}
      <section className="px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-[1.65rem] font-bold tracking-tight text-aura-text md:text-[2rem]">Data Subject Rights</h2>
          <div className="mt-6 overflow-hidden rounded-2xl border border-aura-border-soft bg-aura-bg-card shadow-aura-card">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="bg-aura-bg-alt px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-aura-text">Right</th>
                  <th className="bg-aura-bg-alt px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-aura-text">What it means</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Access", "Request a copy of the screening records and audio associated with your account."],
                  ["Export", "Download your screening history and personal data in a portable format at any time."],
                  ["Erasure", "Request permanent deletion of your recordings and screening history from the system."],
                  ["Withdraw consent", "Decline or withdraw consent for future audio capture without affecting past interactions."],
                ].map(([right, meaning]) => (
                  <tr key={right} className="group">
                    <td className="border-b border-aura-border-soft px-6 py-4 text-sm font-medium text-aura-text">{right}</td>
                    <td className="border-b border-aura-border-soft px-6 py-4 text-sm text-aura-muted group-last:border-b-0">{meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Thesis-stage notice */}
      <section className="aura-dots bg-aura-bg-alt px-6 py-20">
        <div className="mx-auto max-w-4xl">
          <div className="rounded-2xl border border-aura-border bg-gradient-to-br from-aura-bg-alt to-aura-surface-alt p-8 shadow-aura-card">
            <h3 className="text-lg font-bold text-aura-text">Thesis-Stage Disclosure</h3>
            <p className="mt-2 text-sm leading-relaxed text-aura-muted">AURA-Dx is a thesis-stage research prototype developed at the University of Rizal System — Morong Campus. It is intended to demonstrate a screening-support workflow and is not a certified diagnostic medical device. Screening results should not replace evaluation by a licensed physician.</p>
          </div>
        </div>
      </section>
    </div>
  )
}
