import { motion } from "framer-motion"
import { Users } from "lucide-react"
import { staggerContainer, staggerItem } from "@/lib/motion"
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

function TeamCard({ member }: { member: typeof TEAM[number] }) {
  return (
    <motion.div
      variants={staggerItem}
      whileHover={{ y: -6, transition: { type: "spring", stiffness: 300, damping: 24 } }}
      className="group rounded-2xl border border-aura-border-soft bg-aura-bg-card px-5 py-7 text-center shadow-aura-card transition-all duration-300 hover:shadow-aura-card-hover hover:border-aura-accent/25"
    >
      <div className="relative mx-auto mb-5 h-28 w-28 overflow-hidden rounded-full border-[3px] border-aura-accent/15 bg-aura-bg-alt transition-all duration-300 group-hover:border-aura-accent/40 group-hover:shadow-lg group-hover:shadow-aura-accent/10">
        <img
          src={member.img}
          alt={member.name}
          className="block h-full w-full scale-[1.01] object-cover transition-transform duration-500 group-hover:scale-105"
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
        <div className="initials-fallback absolute inset-0 hidden items-center justify-center rounded-full bg-gradient-to-br from-aura-accent-light to-aura-accent text-aura-forest text-lg font-extrabold">
          {member.initials}
        </div>
      </div>
      <h3 className="m-0 text-sm font-bold text-aura-text">{member.name}</h3>
      <div className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-aura-mint-soft px-2.5 py-0.5 text-[0.65rem] font-bold tracking-wider text-aura-forest uppercase">
        {member.role}
      </div>
    </motion.div>
  )
}

export function Team() {
  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-[#0a352e] via-[#0d4a3f] to-aura-forest px-6 py-24 text-center">
        <div aria-hidden="true" className="absolute inset-0 aura-dots opacity-30" />
        <div className="relative z-10 mx-auto max-w-[720px]">
          <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/8 px-4 py-2 text-xs font-semibold tracking-wide text-white/75 backdrop-blur-sm">
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            University of Rizal System
          </span>
          <h1 className="text-[clamp(2rem,4vw,3rem)] font-bold leading-tight tracking-tight text-white">
            Our Team
          </h1>
          <p className="mx-auto mt-5 max-w-[58ch] text-lg leading-relaxed text-white/70">
            AURA-Dx is a BS Computer Engineering thesis project from the University of Rizal System — Morong Campus, built and defended by the team below.
          </p>
        </div>
      </section>

      {/* Team grid */}
      <section className="aura-dots px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <div className="mb-10 text-center">
            <h2 className="text-[clamp(1.6rem,2.5vw,2.2rem)] font-extrabold leading-tight tracking-tight text-aura-text">
              Project Team
            </h2>
            <p className="mt-2 text-aura-muted">The researchers behind AURA-Dx</p>
          </div>
          <motion.div variants={staggerContainer} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.2 }} className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-5">
            {TEAM.map((member) => (
              <TeamCard key={member.name} member={member} />
            ))}
          </motion.div>
        </div>
      </section>
    </div>
  )
}
