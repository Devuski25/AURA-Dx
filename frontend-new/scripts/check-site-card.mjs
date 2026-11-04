/**
 * Does the selected-region card show the right thing for every dropdown option?
 *
 * The card is driven by the dropdown, so a mistake here would show the right
 * region name with the wrong placement instructions -- the worst kind of bug in
 * a screen a clinician is reading while placing a stethoscope.
 *
 * This renders the component for every option in the dropdown and checks the
 * name, the region summary, the detailed points and the technique text. It also
 * pins the contract the product asked for: exactly Anterior and Posterior, with
 * four and six points respectively.
 *
 * It needs the app's own build pipeline to transform TSX, so it runs the
 * component through Vite's SSR loader rather than a separate toolchain.
 */
import { createServer } from "vite"
import { renderToStaticMarkup } from "react-dom/server"
import React from "react"

const EXPECTED = [
  {
    code: "A",
    name: "Anterior",
    pointCount: 4,
    points: [
      "Right Anterior Upper Lobe",
      "Left Anterior Upper Lobe",
      "Right Middle Lobe Field",
      "Left Anterior Lower Division / Lingular Field",
    ],
  },
  {
    code: "P",
    name: "Posterior",
    pointCount: 6,
    points: [
      "Right Posterior Apex",
      "Left Posterior Apex",
      "Right Mid-Posterior Field / Upper-Lower Lobe Interface",
      "Left Mid-Posterior Field / Upper-Lower Lobe Interface",
      "Right Posterior Base",
      "Left Posterior Base",
    ],
  },
]

const escape = (text) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")

const server = await createServer({
  root: process.cwd(),
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
})

try {
  const protocolMod = await server.ssrLoadModule("/src/lib/recording-protocol.ts")
  const { SiteDetail } = await server.ssrLoadModule("/src/components/RecordingProtocol.tsx")

  const sites = protocolMod.AUSCULTATION_SITES
  let failures = 0

  const checks = [
    [sites.length === EXPECTED.length, `dropdown has ${sites.length} region(s), expected ${EXPECTED.length}`],
    [protocolMod.MIN_TAKES === 2, `minimum takes is ${protocolMod.MIN_TAKES}, expected 2`],
    [protocolMod.MAX_TAKES === 5, `maximum takes is ${protocolMod.MAX_TAKES}, expected 5`],
    [protocolMod.MIN_TAKE_SEC === 8, `minimum take length is ${protocolMod.MIN_TAKE_SEC}s, expected 8s`],
    [protocolMod.takeQuality(7.9) === "too-short", "a 7.9s take is flagged too short"],
    [protocolMod.takeQuality(8) === "good", "an 8.0s take passes the floor"],
  ]

  console.log(`  ${sites.length} region(s) in the dropdown\n`)

  EXPECTED.forEach((expected, index) => {
    const site = sites[index]
    const label = `${expected.code} ${expected.name}`
    if (!site) {
      checks.push([false, `${label} is missing`])
      return
    }
    checks.push([
      site.code === expected.code && site.name === expected.name,
      `${label} has code/name ${site.code}/${site.name}`,
    ])
    checks.push([
      Array.isArray(site.points) && site.points.length === expected.pointCount,
      `${label} has ${site.points?.length ?? 0} point(s), expected ${expected.pointCount}`,
    ])
    checks.push([
      expected.points.every((name) => site.points?.some((point) => point.name === name)),
      `${label} has every required point name`,
    ])
  })

  for (const site of sites) {
    const html = renderToStaticMarkup(
      React.createElement(SiteDetail, {
        code: site.code,
        takeNumber: 1,
        lastSiteCode: undefined,
      })
    )

    const hasName = html.includes(site.name)
    const hasWhere = html.includes(escape(site.where))
    const hasHow = html.includes(escape(site.how.split(" ").slice(0, 6).join(" ")))
    const hasPoints =
      Array.isArray(site.points) &&
      site.points.every(
        (point) => html.includes(escape(point.name)) && html.includes(escape(point.where))
      )

    const ok = hasName && hasWhere && hasHow && hasPoints
    if (!ok) failures++
    console.log(
      `  ${ok ? "OK  " : "FAIL"} ${site.code} ${site.name.padEnd(12)} ` +
      `name=${hasName} where=${hasWhere} points=${hasPoints} how=${hasHow}`
    )
  }

  // The old fifth site must not sneak back into the dropdown.
  const hasTrachea = sites.some((site) => site.code === "Tr" || /trachea/i.test(site.name))
  checks.push([!hasTrachea, "trachea is not a selectable region"])

  // An unknown code must not render a half-empty card.
  const unknown = renderToStaticMarkup(
    React.createElement(SiteDetail, { code: "nope", takeNumber: 1 })
  )
  checks.push([unknown === "", "an unknown region code renders nothing"])

  for (const [ok, label] of checks) {
    if (!ok) failures++
    console.log(`  ${ok ? "OK  " : "FAIL"} ${label}`)
  }

  console.log(`\n  ${failures} failure(s)`)
  process.exit(failures ? 1 : 0)
} finally {
  await server.close()
}
