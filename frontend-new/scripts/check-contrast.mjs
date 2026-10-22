/**
 * Does every colour that carries text clear WCAG AA?
 *
 * The app had a bright brand green (#3cb87a) doing duty as a button fill,
 * a text colour and a focus ring. White on it is 2.52:1, so every primary
 * button, every text link and every focus indicator failed AA -- and the
 * focus ring failed the 3:1 that a UI boundary owes. The brand green is
 * still the brand green, but it now decorates rather than carries text.
 *
 * This check reads the real tokens out of index.css and measures the real
 * pairs the app actually uses, so a colour cannot be re-tuned into a
 * failure without the build noticing.
 *
 * It also holds the type scale's floor. The scale was deliberately raised
 * (text-xs is 14px here, not Tailwind's stock 12px) so that clinical text
 * on a phone would be readable, and then twenty-eight hand-written sizes
 * were added below that floor -- including the confidence percentage, the
 * one number a clinician most needs to read.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const root = process.cwd()
const src = join(root, "src")
const css = readFileSync(join(src, "index.css"), "utf8")

/* ── the tokens ───────────────────────────────────────────────────────── */

function token(name) {
  /* A token can be a shadcn semantic (`--primary`) or an AURA one
     (`--color-aura-pine`). Both are looked up, colour form first. */
  const m =
    css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{3,8})\\b`)) ||
    css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})\\b`))
  if (!m) return null
  let hex = m[1]
  if (hex.length === 4) hex = "#" + hex.slice(1).split("").map((c) => c + c).join("")
  return hex
}

function luminance(hex) {
  const h = hex.replace("#", "")
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const c = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b)
}

function ratio(a, b) {
  const la = luminance(a)
  const lb = luminance(b)
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

let failures = 0

/* ── 1. the pairs the app actually renders ───────────────────────────── */

/* [foreground, background, label, minimum] */
const PAIRS = [
  ["primary-foreground", "primary", "the primary button", 4.5],
  ["accent-foreground", "accent", "the outline / ghost button", 4.5],
  ["destructive-foreground", "destructive", "the destructive button", 4.5],
  ["foreground", "background", "body text on the page", 4.5],
  ["muted-foreground", "background", "muted text on the page", 4.5],
  ["aura-text", "background", "the app's own body colour", 4.5],
  ["aura-muted", "background", "muted text on the page", 4.5],
  ["aura-pine", "background", "the 'good' status colour", 4.5],
  ["aura-pine", "aura-surface", "the 'good' colour on the canvas", 4.5],
  ["aura-pine", "aura-surface-alt", "the 'good' colour on a tile", 4.5],
  ["aura-pine", "aura-mint-soft", "the Healthy badge", 4.5],
  ["aura-coral-strong", "aura-coral-soft", "the Pneumonia badge", 4.5],
  ["aura-warning-strong", "aura-warning-soft", "the Pending Review badge", 4.5],
  ["aura-forest", "aura-surface-alt", "the 'Reviewed' badge", 4.5],
  ["aura-forest", "background", "the forest colour as text", 4.5],
  ["foreground", "aura-surface-alt", "the info badge", 4.5],
  ["foreground", "secondary", "the secondary badge", 4.5],

  /* A control boundary owes 3:1, not 4.5:1 -- but only if it is the thing
     that says "this is a control". A form field's outline is. */
  ["input", "background", "a form field's border", 3.0],
  ["ring", "background", "the focus ring", 3.0],
]

console.log("  colour pairs")
for (const [fgName, bgName, label, min] of PAIRS) {
  const fg = token(fgName)
  const bg = token(bgName)
  if (!fg || !bg) {
    console.log(`  FAIL ${label}: token ${!fg ? fgName : bgName} is not defined`)
    failures++
    continue
  }
  const r = ratio(fg, bg)
  const ok = r >= min
  if (!ok) failures++
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label.padEnd(34)} ${r.toFixed(2)}:1  (needs ${min})`)
}

/* ── 2. no text colour that cannot carry text ─────────────────────────── */

/* These are the decorative greens and ambers. As an icon, a fill or a
   gradient they are fine. As TEXT they fail, so they may not be used as
   a text colour anywhere. */
const BANNED_TEXT = [
  { re: /text-aura-accent(?!-)/, why: "the brand green is 2.52:1 on white" },
  { re: /text-aura-accent-dark(?!-)/, why: "it is 3.56:1 on white" },
  { re: /text-aura-warning(?!-)/, why: "the bright amber is 3.19:1 on white" },
  { re: /text-aura-coral(?!-)/, why: "it is 3.77:1 on white" },
]

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(tsx|ts)$/.test(entry)) out.push(full)
  }
  return out
}

const offScale = []
const banned = []

for (const file of walk(src)) {
  const text = readFileSync(file, "utf8")
  const code = text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "))
  code.split("\n").forEach((line, i) => {
    for (const raw of line.split(/\s+/)) {
      const cls = raw.replace(/["'`]/g, "")
      for (const rule of BANNED_TEXT) {
        if (rule.re.test(cls)) {
          banned.push({ file: relative(root, file), line: i + 1, cls, why: rule.why })
          failures++
        }
      }
    }
    /* The type scale's floor is 14px -- text-xs in this app. Anything
       smaller is off-scale and, on a phone, unreadable. */
    for (const m of line.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) {
      if (parseFloat(m[1]) < 14) {
        offScale.push({ file: relative(root, file), line: i + 1, cls: m[0] })
        failures++
      }
    }
  })
}

console.log("\n  text colours that cannot carry text")
if (banned.length === 0) {
  console.log("  OK   none used as a text colour")
} else {
  for (const b of banned.slice(0, 30)) {
    console.log(`  FAIL ${b.file}:${b.line}  ${b.cls}  -- ${b.why}`)
  }
  if (banned.length > 30) console.log(`  ... and ${banned.length - 30} more`)
}

console.log("\n  text below the 14px floor")
if (offScale.length === 0) {
  console.log("  OK   every size is on the scale")
} else {
  for (const o of offScale.slice(0, 30)) {
    console.log(`  FAIL ${o.file}:${o.line}  ${o.cls}`)
  }
  if (offScale.length > 30) console.log(`  ... and ${offScale.length - 30} more`)
}

console.log(`\n  ${failures} failure(s)`)
process.exit(failures ? 1 : 0)
