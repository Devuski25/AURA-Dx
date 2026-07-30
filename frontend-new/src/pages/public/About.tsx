import { useState } from "react"
import { motion } from "framer-motion"
import { cardHover, fadeUp, staggerContainer, staggerItem } from "@/lib/motion"

const CLASS_INFO: Record<string, { title: string; desc: string }> = {
  healthy: {
    title: "Healthy",
    desc: "A baseline acoustic profile indicating clear airways. Healthy coughs generally have a sharp, unimpeded initial burst and lack the prolonged wheezing or wet sounds found in respiratory illnesses.",
  },
  copd: {
    title: "Chronic Obstructive Pulmonary Disease (COPD)",
    desc: "A group of lung conditions that cause breathing difficulties. COPD coughs are often chronic and can exhibit distinct acoustic markers such as lower-frequency wheezing and prolonged exhalation phases due to airflow obstruction.",
  },
  pneumonia: {
    title: "Pneumonia",
    desc: "An infection that inflames the air sacs in one or both lungs, which may fill with fluid. Coughs associated with pneumonia often have a “wet” or productive acoustic signature, characterized by specific frequency deviations.",
  },
  tb: {
    title: "Tuberculosis (TB)",
    desc: "A serious infectious bacterial disease that mainly affects the lungs. TB coughs have a highly specific signature which our Tier 1 model isolates. Early detection of this pattern is crucial for isolation and treatment.",
  },
}

const CLASS_KEYS = ["healthy", "copd", "pneumonia", "tb"]

export function About() {
  const [activeClass, setActiveClass] = useState("healthy")

  return (
    <div>
      {/* Hero */}
      <section className="flex items-center justify-center bg-gradient-to-b from-cough-bg-alt to-cough-bg px-6 py-18 text-center">
        <div className="mx-auto max-w-[720px]">
          <h1 className="text-[clamp(2rem,4vw,2.6rem)] font-bold leading-tight tracking-tight text-cough-text">
            About the System
          </h1>
          <p className="mx-auto mt-4 max-w-[58ch] text-lg leading-relaxed text-cough-muted">
            Coughing is not random noise. Its acoustic shape carries information about the airway that produced it. CoughPH is built to read that signature.
          </p>
        </div>
      </section>

      {/* Two-tier pipeline */}
      <section className="px-6 py-8">
        <div className="mx-auto max-w-[1040px]">
          <h2 className="text-[1.55rem] font-bold tracking-tighter text-cough-text">Two-Tier Gated Classification Pipeline</h2>
          <p className="text-cough-muted">Rather than one model guessing across every condition at once, screening runs through two purpose-built stages in sequence.</p>
          <motion.div variants={staggerContainer} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.3 }} className="mt-7 grid gap-5 md:grid-cols-2">
            <motion.div variants={staggerItem} whileHover={cardHover.whileHover} whileTap={cardHover.whileTap} className="rounded-2xl border border-cough-border-soft bg-cough-bg-card p-7 shadow-cough-md">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[#6ed4a4] to-cough-accent-dark shadow-cough-sm">
                <svg className="h-6 w-6 stroke-white" viewBox="0 0 24 24" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 11l3 3L22 4" />
                  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                </svg>
              </div>
              <span className="inline-block rounded-full bg-cough-accent-dark px-2.5 py-0.5 text-[0.72rem] font-bold tracking-wider text-white">TIER 1</span>
              <h3 className="mt-3 text-lg font-bold text-cough-text">TB Gatekeeper</h3>
              <p className="text-sm text-cough-muted">A focused binary check on a short 0.34s window of the cough, screening specifically for tuberculosis. A positive result halts the pipeline and returns a TB alert immediately.</p>
            </motion.div>
            <motion.div variants={staggerItem} whileHover={cardHover.whileHover} whileTap={cardHover.whileTap} className="rounded-2xl border border-cough-border-soft bg-cough-bg-card p-7 shadow-cough-md">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[#6ed4a4] to-cough-accent-dark shadow-cough-sm">
                <svg className="h-6 w-6 stroke-white" viewBox="0 0 24 24" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                  <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4" />
                </svg>
              </div>
              <span className="inline-block rounded-full bg-cough-accent-dark px-2.5 py-0.5 text-[0.72rem] font-bold tracking-wider text-white">TIER 2</span>
              <h3 className="mt-3 text-lg font-bold text-cough-text">Respiratory Classifier</h3>
              <p className="text-sm text-cough-muted">If TB is ruled out, a second model analyzes a wider 2.0s window to classify the cough as COPD, Healthy, or Pneumonia.</p>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Four Screening Classes */}
      <section className="bg-cough-bg-alt px-6 py-8">
        <div className="mx-auto max-w-[820px] text-center">
          <h2 className="text-[1.55rem] font-bold tracking-tighter text-cough-text">Four Screening Classes</h2>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            {CLASS_KEYS.map((key) => (
              <button
                key={key}
                onClick={() => setActiveClass(key)}
                className={`cursor-pointer rounded-full border-2 px-5 py-2.5 text-sm font-semibold font-[inherit] transition-all duration-200 ${
                  activeClass === key
                    ? "border-transparent bg-gradient-to-r from-[#5ecf98] to-cough-accent-dark text-white shadow-cough-md"
                    : "border-cough-border bg-white text-cough-muted shadow-cough-sm hover:border-cough-accent hover:text-cough-accent-dark hover:bg-cough-accent-soft hover:-translate-y-px"
                }`}
              >
                {CLASS_INFO[key].title}
              </button>
            ))}
          </div>
          <motion.div variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true }} className="mx-auto mt-6 max-w-[640px] rounded-2xl border border-cough-border-soft bg-cough-bg-card p-6 text-left shadow-cough-md">
            <h3 className="m-0 text-lg font-bold text-cough-text">{CLASS_INFO[activeClass].title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-cough-muted">{CLASS_INFO[activeClass].desc}</p>
          </motion.div>
        </div>
      </section>

      {/* Signal Processing */}
      <section className="px-6 py-8">
        <div className="mx-auto max-w-[1040px]">
          <div className="grid items-center gap-10 md:grid-cols-2">
            <div>
              <h2 className="text-[1.55rem] font-bold tracking-tighter text-cough-text">Signal Processing</h2>
              <p className="text-cough-muted">Raw audio is standardized to 16 kHz mono, passed through a low-pass filter to reduce high-frequency noise, then converted into a Log-Mel Spectrogram — the same representation used for both tiers, sliced to a different time window for each.</p>
            </div>
            <motion.table variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true }} className="w-full border-separate overflow-hidden rounded-2xl border border-cough-border-soft bg-cough-bg-card shadow-cough-md">
              <thead>
                <tr>
                  <th className="bg-cough-bg-alt px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-cough-text">Step</th>
                  <th className="bg-cough-bg-alt px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-cough-text">Detail</th>
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
                    <td className="border-b border-cough-border-soft px-5 py-3.5 text-sm font-medium text-cough-text">{step}</td>
                    <td className="border-b border-cough-border-soft px-5 py-3.5 text-sm text-cough-muted group-last:border-b-0">{detail}</td>
                  </tr>
                ))}
              </tbody>
            </motion.table>
          </div>
        </div>
      </section>

      {/* Hardware */}
      <section className="bg-cough-bg-alt px-6 py-8">
        <div className="mx-auto max-w-[1040px]">
          <div className="grid items-center gap-10 md:grid-cols-2">
            <motion.table variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true }} className="w-full border-separate overflow-hidden rounded-2xl border border-cough-border-soft bg-cough-bg-card shadow-cough-md">
              <thead>
                <tr>
                  <th className="bg-cough-bg-alt px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-cough-text">Component</th>
                  <th className="bg-cough-bg-alt px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-cough-text">Role</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["ESP32-S3", "Microcontroller, primary capture device"],
                  ["INMP441 Mic", "I2S digital audio input"],
                  ["MQTT", "Transport from device to web app"],
                  ["Browser UI", "Fallback (mic record / WAV upload)"],
                ].map(([comp, role]) => (
                  <tr key={comp} className="group">
                    <td className="border-b border-cough-border-soft px-5 py-3.5 text-sm font-medium text-cough-text">{comp}</td>
                    <td className="border-b border-cough-border-soft px-5 py-3.5 text-sm text-cough-muted group-last:border-b-0">{role}</td>
                  </tr>
                ))}
              </tbody>
            </motion.table>
            <div>
              <h2 className="text-[1.55rem] font-bold tracking-tighter text-cough-text">Hardware &amp; Fallback</h2>
              <p className="text-cough-muted">The primary path is a dedicated ESP32-S3 device with an INMP441 microphone over I2S, publishing over MQTT. If offline, the web app records from a browser microphone or accepts an uploaded WAV file, so a screening is never blocked on hardware availability.</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
