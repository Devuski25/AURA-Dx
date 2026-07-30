export function Legal() {
  return (
    <div>
      {/* Hero */}
      <section className="flex items-center justify-center bg-gradient-to-b from-cough-bg-alt to-cough-bg px-6 py-18 text-center">
        <div className="mx-auto max-w-[720px]">
          <h1 className="text-[clamp(2rem,4vw,2.6rem)] font-bold leading-tight tracking-tight text-cough-text">
            Legal &amp; Patient Privacy
          </h1>
          <p className="mx-auto mt-4 max-w-[58ch] text-lg leading-relaxed text-cough-muted">
            CoughPH processes cough audio and screening results, which qualify as personal — and in some contexts sensitive personal — information under Philippine law. This page explains what is collected, why, and what rights you hold over it.
          </p>
        </div>
      </section>

      {/* Governing law */}
      <section className="px-6 py-8">
        <div className="mx-auto max-w-[1040px]">
          <h2 className="text-[1.55rem] font-bold tracking-tighter text-cough-text">Governing Law</h2>
          <div className="mt-4 grid gap-5 md:grid-cols-2">
            <div className="rounded-2xl border border-cough-border-soft bg-cough-bg-card p-7 shadow-cough-md transition-all duration-250 hover:shadow-cough-lg">
              <h3 className="text-lg font-bold text-cough-text">R.A. 10173 — Data Privacy Act of 2012</h3>
              <p className="text-sm text-cough-muted">Requires informed consent before collecting personal data, limits use to the stated purpose, and grants data subjects the right to access, correct, and erase their information.</p>
            </div>
            <div className="rounded-2xl border border-cough-border-soft bg-cough-bg-card p-7 shadow-cough-md transition-all duration-250 hover:shadow-cough-lg">
              <h3 className="text-lg font-bold text-cough-text">R.A. 10175 — Cybercrime Prevention Act of 2012</h3>
              <p className="text-sm text-cough-muted">Criminalizes unauthorized access to computer systems and data, and illegal interception of data in transit. Applies to audio uploads, MQTT device traffic, and portal access.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Consent */}
      <section className="bg-cough-bg-alt px-6 py-8">
        <div className="mx-auto max-w-[1040px]">
          <h2 className="text-[1.55rem] font-bold tracking-tighter text-cough-text">Consent</h2>
          <p className="text-cough-muted">Every screening session — live microphone or uploaded file — is gated behind an explicit consent step before any audio is captured or processed. Declining consent stops the flow at that point; no data is retained.</p>
        </div>
      </section>

      {/* Data Subject Rights */}
      <section className="px-6 py-8">
        <div className="mx-auto max-w-[1040px]">
          <h2 className="text-[1.55rem] font-bold tracking-tighter text-cough-text">Data Subject Rights</h2>
          <div className="mt-4 overflow-hidden rounded-2xl border border-cough-border-soft bg-cough-bg-card shadow-cough-md">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="bg-cough-bg-alt px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-cough-text">Right</th>
                  <th className="bg-cough-bg-alt px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-cough-text">What it means</th>
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
                    <td className="border-b border-cough-border-soft px-5 py-3.5 text-sm font-medium text-cough-text">{right}</td>
                    <td className="border-b border-cough-border-soft px-5 py-3.5 text-sm text-cough-muted group-last:border-b-0">{meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Thesis-stage notice */}
      <section className="bg-cough-bg-alt px-6 py-8">
        <div className="mx-auto max-w-[1040px]">
          <div className="rounded-2xl border border-cough-border bg-gradient-to-br from-cough-bg-alt to-cough-surface-alt p-7 shadow-cough-md">
            <h3 className="text-lg font-bold text-cough-text">Thesis-Stage Disclosure</h3>
            <p className="text-sm text-cough-muted">CoughPH is a thesis-stage research prototype developed at the University of Rizal System — Morong Campus. It is intended to demonstrate a screening-support workflow and is not a certified diagnostic medical device. Screening results should not replace evaluation by a licensed physician.</p>
          </div>
        </div>
      </section>
    </div>
  )
}
