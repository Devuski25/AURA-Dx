/**
 * Is every hover style split correctly for a touch screen?
 *
 * A phone and a tablet are touched, not hovered, and on a touch screen a
 * tap latches the `:hover` state -- the control keeps its hover colour
 * after the finger has moved on. That reads as a button stuck half
 * pressed.
 *
 * The app splits its hover styles in two:
 *
 *   `hover-tap:`  a COLOUR change. On a touch layout the control simply
 *                 carries that colour all the time; on the desktop it is
 *                 an ordinary hover.
 *   `lg:hover:`   everything else -- the shadow, the lift, the underline.
 *                 Desktop only, because those latch on a touch screen.
 *
 * So a stock `hover:` should not survive anywhere. This check reads the
 * source, because the stylesheet only shows the result, and it would not
 * tell you which of the two a new style should have been.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const root = process.cwd()
const src = join(root, "src")

/* The colour utilities. A hover on one of these changes what the control
   LOOKS like, so it has to become the resting colour on a touch layout. */
const COLOUR = /^hover:(bg|text|border|ring|opacity)-/

/* The flourishes. A hover on one of these moves or shades the control
   without changing its colour, and a permanently raised card is worse
   than a flat one, so these are desktop only. */
const FLOURISH = /^hover:(scale|translate|shadow|brightness|underline|rotate|skew)-/

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(tsx|ts)$/.test(entry)) out.push(full)
  }
  return out
}

let failures = 0
const report = []

/* ── 1. the variants themselves have to exist ─────────────────────────── */
const css = readFileSync(join(src, "index.css"), "utf8")
for (const variant of ["hover-tap", "group-hover-tap"]) {
  const ok = css.includes(`@custom-variant ${variant} `)
  if (!ok) failures++
  console.log(`  ${ok ? "OK  " : "FAIL"} @custom-variant ${variant} is defined`)
}

/* ── 2. the touch marker has to be set ────────────────────────────────── */
const main = readFileSync(join(src, "main.tsx"), "utf8")
const marked = main.includes("markTouchLayout()")
if (!marked) failures++
console.log(`  ${marked ? "OK  " : "FAIL"} main.tsx marks the touch layout before the first render`)

const marker = join(src, "lib", "touch-layout.ts")
const markerOk = (() => {
  try {
    const t = readFileSync(marker, "utf8")
    return t.includes("data-tap") && t.includes("max-width: 1023px")
  } catch {
    return false
  }
})()
if (!markerOk) failures++
console.log(`  ${markerOk ? "OK  " : "FAIL"} lib/touch-layout.ts sets data-tap below the desktop breakpoint`)

/* ── 3. no stock hover: survives ──────────────────────────────────────── */
console.log("\n  every hover: is either hover-tap: or lg:hover:")
for (const file of walk(src)) {
  const text = readFileSync(file, "utf8")
  // Blank out the comments, keeping the line count so the line numbers
  // still point at the right place. A block comment can run over several
  // lines, so it is matched across newlines.
  const code = text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "))
  code.split("\n").forEach((line, i) => {
    for (const raw of line.split(/\s+/)) {
      const token = raw.replace(/["'`]/g, "")
      if (!token.includes("hover:")) continue
      // A token is fine if it carries hover-tap:, or if its hover: is
      // behind an lg: breakpoint.
      if (token.includes("hover-tap:")) continue
      // A media query is not a class. `(hover: none)` in a matchMedia string
      // is asking the device a question, not styling anything.
      if (token.includes("(hover:")) continue
      if (/(^|:)lg:hover:/.test(token)) continue
      if (/(^|:)lg:group-hover:/.test(token)) continue
      // Anything left is a stock hover, or a group-hover that was never
      // given a touch counterpart.
      const kind = COLOUR.test(token) ? "colour" : FLOURISH.test(token) ? "flourish" : "unknown"
      report.push({ file: relative(root, file), line: i + 1, cls: token, why: `stock hover (${kind})` })
      failures++
    }
  })
}

if (report.length === 0) {
  console.log("  OK   no stock hover: left in the source")
} else {
  for (const r of report.slice(0, 40)) {
    console.log(`  FAIL ${r.file}:${r.line}  ${r.cls}  -- ${r.why}`)
  }
  if (report.length > 40) console.log(`  ... and ${report.length - 40} more`)
}

console.log(`\n  ${failures} failure(s)`)
process.exit(failures ? 1 : 0)
