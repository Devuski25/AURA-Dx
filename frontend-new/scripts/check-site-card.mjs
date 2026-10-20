/**
 * Does the selected-site card show the right thing for every option?
 *
 * The card is driven by the dropdown, so a mistake here would show the right
 * site name with the wrong placement instructions -- the worst kind of bug in
 * a screen a clinician is reading while placing a stethoscope.
 *
 * This renders the component for every option in the dropdown and checks the
 * name and the instructions that come out. It needs the app's own build
 * pipeline to transform TSX, so it runs the component through Vite's SSR
 * loader rather than a separate toolchain.
 */
import { createServer } from "vite"
import { renderToStaticMarkup } from "react-dom/server"
import React from "react"

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
  const React2 = await import("react")

  let failures = 0
  console.log(`  ${sites.length} site(s) in the dropdown\n`)

  for (const site of sites) {
    const html = renderToStaticMarkup(
      React2.createElement(SiteDetail, {
        code: site.code,
        takeNumber: 1,
        lastSiteCode: undefined,
      })
    )

    const hasName = html.includes(site.name)
    const hasWhere = html.includes(site.where.replace(/"/g, "&quot;").replace(/'/g, "&#x27;"))
    const hasHow = html.includes(site.how.split(" ").slice(0, 6).join(" "))

    const ok = hasName && hasWhere && hasHow
    if (!ok) failures++
    console.log(
      `  ${ok ? "OK  " : "FAIL"} ${site.code} ${site.name.padEnd(20)} ` +
      `name=${hasName} where=${hasWhere} how=${hasHow}`
    )
  }

  // An unknown code must not render a half-empty card.
  const unknown = renderToStaticMarkup(
    React2.createElement(SiteDetail, { code: "nope", takeNumber: 1 })
  )
  const unknownOk = unknown === ""
  if (!unknownOk) failures++
  console.log(`\n  ${unknownOk ? "OK  " : "FAIL"} an unknown site code renders nothing`)

  console.log(`\n  ${failures} failure(s)`)
  process.exit(failures ? 1 : 0)
} finally {
  await server.close()
}
