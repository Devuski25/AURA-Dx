/**
 * Does the route prefetcher fetch the right thing?
 *
 * A prefetcher that fetches the wrong chunk is worse than no prefetcher: it
 * spends the clinic's bandwidth on a page nobody opens, and the page that
 * was wanted still has to be downloaded.
 *
 * The trap this checks is the ordering. "/dashboard/screenings/123" also
 * starts with "/dashboard/screenings", so a matcher that tests the list route
 * first would send a patient's record to the list chunk -- and the record
 * would then have to be downloaded a second time when it was actually
 * opened.
 */
import { createServer } from "vite"

const server = await createServer({
  root: process.cwd(),
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
})

let failures = 0

try {
  const mod = await server.ssrLoadModule("/src/lib/route-prefetch.ts")
  const { routeForPath, likelyNextRoutes } = mod

  console.log("  path -> route")
  const cases = [
    ["/dashboard", "dashboard"],
    ["/dashboard/", "dashboard"],
    ["/dashboard/screening", "screening"],
    ["/dashboard/screenings", "records"],
    ["/dashboard/patient-records", "records"],
    ["/dashboard/patients/abc-123", "patient"],
    ["/dashboard/screenings/abc-123", "screening-detail"],
    ["/dashboard/admin", "admin"],
    ["/", null],
    ["/login", null],
    ["/about", null],
  ]
  for (const [path, expected] of cases) {
    const got = routeForPath(path)
    const ok = got === expected
    if (!ok) failures++
    console.log(
      `  ${ok ? "OK  " : "FAIL"} ${path.padEnd(30)} -> ${String(got).padEnd(18)}` +
      (ok ? "" : `(expected ${expected})`)
    )
  }

  console.log("\n  what is prefetched from where")
  const next = [
    ["/dashboard", ["records", "screening"]],
    ["/dashboard/screenings", ["patient", "screening-detail"]],
    ["/dashboard/patients/abc", ["records"]],
    ["/dashboard/screenings/abc", ["records"]],
    ["/login", []],
  ]
  for (const [path, expected] of next) {
    const got = likelyNextRoutes(path)
    const ok = JSON.stringify(got) === JSON.stringify(expected)
    if (!ok) failures++
    console.log(
      `  ${ok ? "OK  " : "FAIL"} ${path.padEnd(30)} -> ${JSON.stringify(got)}` +
      (ok ? "" : ` (expected ${JSON.stringify(expected)})`)
    )
  }

  // Every route the app can name must actually load. A route that points at
  // a module that does not exist would throw on the first prefetch.
  console.log("\n  every named route loads")
  const names = ["dashboard", "screening", "records", "patient", "screening-detail", "admin"]
  for (const name of names) {
    let ok = true
    let detail = ""
    try {
      await mod.prefetchRoute(name)
      // The loader is dynamic, so give it a moment to settle.
      await new Promise((r) => setTimeout(r, 50))
    } catch (e) {
      ok = false
      detail = String(e)
    }
    if (!ok) failures++
    console.log(`  ${ok ? "OK  " : "FAIL"} ${name.padEnd(18)} ${detail}`)
  }

  console.log(`\n  ${failures} failure(s)`)
  process.exit(failures ? 1 : 0)
} catch (e) {
  console.error(e)
  process.exit(1)
} finally {
  await server.close()
}
