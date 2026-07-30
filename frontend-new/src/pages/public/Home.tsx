import { Link } from "react-router-dom"
import WebdesHero from "@/assets/public/webdes.png"

export function Home() {
  return (
    <div>
      {/* Hero */}
      <section className="px-10 py-0">
        <div className="mx-auto grid max-w-[1040px] items-center gap-12 md:grid-cols-[1.1fr_0.9fr]">
          <div>
            <h1 className="m-0 max-w-[20ch] text-4xl font-bold leading-tight tracking-tighter text-cough-text md:text-[2.35rem]">
              AI-assisted respiratory screening.
            </h1>
            <p className="mt-4 max-w-[52ch] text-base text-cough-muted md:text-lg">
              CoughPH analyzes the sound of a cough through a two-tier gated AI pipeline: a focused check for tuberculosis first,
              then a second model screening for COPD, Pneumonia, or a healthy result.
            </p>
          </div>
          <div className="overflow-visible">
            <img
              src={WebdesHero}
              alt="CoughPH hero"
              className="block w-full rounded-2xl object-contain saturate-[0.95] contrast-[0.98]"
            />
          </div>
        </div>
      </section>

      {/* Pipeline */}
      <section className="bg-cough-bg-alt py-8">
        <div className="mx-auto max-w-[1040px] px-6">
          <h2 className="m-0 text-[1.55rem] font-bold tracking-tighter text-cough-text">How the System Works</h2>
          <p className="mt-1 text-cough-muted">One audio clip moves through two gated stages before it becomes a screening result.</p>
          <div className="mt-7 grid gap-5 md:grid-cols-2">
            <div className="rounded-2xl border border-cough-border-soft bg-cough-bg-card p-7 shadow-[0_4px_20px_rgba(42,154,99,0.08)] transition-all duration-250 hover:shadow-[0_12px_32px_rgba(42,154,99,0.14)] hover:-translate-y-1">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[#6ed4a4] to-cough-accent-dark shadow-[0_4px_12px_rgba(42,154,99,0.2)]">
                <svg className="h-6 w-6 stroke-white" viewBox="0 0 24 24" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 11l3 3L22 4" />
                  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                </svg>
              </div>
              <span className="inline-block rounded-full bg-cough-accent-dark px-2.5 py-0.5 text-[0.72rem] font-bold tracking-wider text-white">TIER 1</span>
              <h3 className="mt-3 text-lg font-bold text-cough-text">TB Gatekeeper</h3>
              <p className="text-sm text-cough-muted">A focused check for tuberculosis. A positive result halts the pipeline and returns an alert immediately.</p>
            </div>
            <div className="rounded-2xl border border-cough-border-soft bg-cough-bg-card p-7 shadow-[0_4px_20px_rgba(42,154,99,0.08)] transition-all duration-250 hover:shadow-[0_12px_32px_rgba(42,154,99,0.14)] hover:-translate-y-1">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[#6ed4a4] to-cough-accent-dark shadow-[0_4px_12px_rgba(42,154,99,0.2)]">
                <svg className="h-6 w-6 stroke-white" viewBox="0 0 24 24" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                  <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4" />
                </svg>
              </div>
              <span className="inline-block rounded-full bg-cough-accent-dark px-2.5 py-0.5 text-[0.72rem] font-bold tracking-wider text-white">TIER 2</span>
              <h3 className="mt-3 text-lg font-bold text-cough-text">Respiratory Classifier</h3>
              <p className="text-sm text-cough-muted">If TB is ruled out, screens for COPD or Pneumonia, or confirms a healthy result.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Built for Clinic */}
      <section className="py-8">
        <div className="mx-auto max-w-[1040px] px-6">
          <div className="grid gap-9 md:grid-cols-2">
            <div>
              <h2 className="text-[1.55rem] font-bold tracking-tighter text-cough-text">Built for the Clinic</h2>
              <p className="text-cough-muted">The primary capture device is an ESP32-S3 with an INMP441 microphone over MQTT. If the device is unavailable, screening also works from a browser microphone recording or an uploaded WAV file.</p>
            </div>
            <div className="rounded-2xl border border-cough-border-soft bg-cough-bg-card p-7 shadow-[0_4px_20px_rgba(42,154,99,0.08)]">
              <h3 className="text-lg font-bold text-cough-text">Doctor / Nurse Portal</h3>
              <p className="text-sm text-cough-muted">Clinicians can review the spectrogram, confidence score, and a suggested next step for every screening session.</p>
            </div>
          </div>

          {/* FAQ */}
          <h2 className="mt-12 text-[1.55rem] font-bold tracking-tighter text-cough-text">Frequently Asked Questions</h2>
          <div className="mt-2 flex flex-col gap-3">
            {[
              {
                q: "Is a CoughPH result a medical diagnosis?",
                a: "No. CoughPH is a screening-support tool, not a certified diagnostic device. A result is a suggested next step, not a diagnosis, and should not replace evaluation by a licensed physician.",
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
                q: "What conditions does CoughPH screen for?",
                a: "Four classes: Healthy, COPD, Pneumonia, and Tuberculosis, using the two-tier gated pipeline described on the About System page.",
              },
            ].map((faq) => (
              <details
                key={faq.q}
                className="group rounded-2xl border border-cough-border-soft bg-cough-bg-card shadow-[0_4px_20px_rgba(42,154,99,0.08)] transition-shadow hover:shadow-[0_12px_32px_rgba(42,154,99,0.14)]"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between px-5.5 py-4 text-sm font-semibold text-cough-text [&::-webkit-details-marker]:hidden">
                  {faq.q}
                  <span className="ml-4 text-lg font-semibold text-cough-accent transition-transform group-open:rotate-180">+</span>
                </summary>
                <p className="m-0 px-5.5 pb-5 pr-6 text-sm text-cough-muted">{faq.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Consent notice */}
      <section className="bg-cough-bg-alt py-8">
        <div className="mx-auto max-w-[1040px] px-6">
          <div className="rounded-2xl border border-cough-border bg-gradient-to-br from-[#f0faf5] to-[#e4f5ec] p-7 shadow-[0_4px_20px_rgba(42,154,99,0.08)]">
            <h3 className="text-lg font-bold text-cough-text">Consent-First, and Compliant with Philippine Law</h3>
            <p className="text-sm text-cough-muted">No audio is captured without explicit, informed consent. CoughPH follows the Data Privacy Act of 2012 (R.A. 10173) and the Cybercrime Prevention Act of 2012 (R.A. 10175).</p>
            <Link to="/legal" className="mt-1 inline-block font-bold text-cough-accent-dark no-underline hover:text-cough-accent">
              Read the full Legal & Privacy page &rarr;
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
