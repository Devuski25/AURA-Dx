import { useEffect, useRef } from "react"
import DesireeImg from "@/assets/public/team/desiree-mejes.jpg"
import AhldousImg from "@/assets/public/team/ahldous-argayoso.jpg"
import RheinImg from "@/assets/public/team/rhein-cama.jpg"
import MichaelImg from "@/assets/public/team/michael-nepomuceno.jpg"
import MarkImg from "@/assets/public/team/mark-pesuelo.jpg"

const TEAM = [
  { name: "Desiree May Mejes", initials: "DM", img: DesireeImg, role: "Researcher" },
  { name: "Ahldous Meinard Argayoso", initials: "AA", img: AhldousImg, role: "Researcher" },
  { name: "Rhein David Cama", initials: "RC", img: RheinImg, role: "Researcher" },
  { name: "Michael Harvy Nepomuceno", initials: "MN", img: MichaelImg, role: "Researcher" },
  { name: "Mark Louie Pesuelo", initials: "MP", img: MarkImg, role: "Researcher" },
]

function TeamCard({ member, index }: { member: typeof TEAM[number]; index: number }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible")
            io.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.15 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className="translate-y-3.5 rounded-[18px] border border-[rgba(15,23,42,0.08)] bg-[rgba(255,255,255,0.72)] px-4 py-5.5 text-center opacity-0 shadow-[0_10px_25px_rgba(2,6,23,0.06)] transition-all duration-[650ms] ease-in-out is-visible:translate-y-0 is-visible:opacity-100 hover:shadow-[0_12px_32px_rgba(42,154,99,0.14)] hover:-translate-y-1"
      style={{ transitionDelay: `${index * 60}ms` }}
    >
      <div className="relative mx-auto mb-3.5 h-28 w-28 overflow-hidden rounded-full border-[3px] border-[rgba(56,189,248,0.25)] bg-[rgba(2,6,23,0.04)]">
        <img
          src={member.img}
          alt={member.name}
          className="block h-full w-full scale-[1.01] object-cover"
          loading="lazy"
          decoding="async"
          onError={(e) => {
            e.currentTarget.style.display = "none"
            const fb = e.currentTarget.parentElement?.querySelector(".initials-fallback") as HTMLElement
            if (fb) fb.style.display = "grid"
          }}
          onLoad={(e) => {
            const fb = e.currentTarget.parentElement?.querySelector(".initials-fallback") as HTMLElement
            if (fb) fb.style.display = "none"
          }}
        />
        <div className="initials-fallback absolute inset-0 hidden items-center justify-center rounded-full bg-[rgba(56,189,248,0.15)] text-[#0284c7] text-lg font-extrabold">
          {member.initials}
        </div>
      </div>
      <h3 className="m-0 text-base font-[750] text-[#0f172a]">{member.name}</h3>
      <div className="mt-1 text-[0.70rem] font-semibold text-[rgba(15,23,42,0.7)]">{member.role}</div>
    </div>
  )
}

export function Team() {
  return (
    <div>
      {/* Hero */}
      <section className="flex items-center justify-center bg-gradient-to-b from-[#f0faf5] to-cough-bg px-6 py-18 text-center">
        <div className="mx-auto max-w-[720px]">
          <h1 className="text-[clamp(2rem,4vw,2.6rem)] font-bold leading-tight tracking-tight text-cough-text">
            Our Team
          </h1>
          <p className="mx-auto mt-4 max-w-[58ch] text-lg leading-relaxed text-cough-muted">
            CoughPH is a BS Computer Engineering thesis project from the University of Rizal System — Morong Campus, built and defended by the team below.
          </p>
        </div>
      </section>

      {/* Team grid */}
      <section className="px-6 py-14">
        <div className="mx-auto max-w-[1040px]">
          <div className="mb-6 text-center">
            <h2 className="text-[clamp(1.6rem,2.5vw,2.2rem)] font-extrabold leading-tight tracking-[0.2px] text-[#0f172a]">
              Project Team
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
            {TEAM.map((member, i) => (
              <TeamCard key={member.name} member={member} index={i} />
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
