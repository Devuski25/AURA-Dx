/**
 * Dev-only API mock — lets the authenticated pages render with realistic data
 * while the FastAPI backend is not running.
 *
 * Installed by patching `window.fetch` and short-circuiting any request that
 * targets `/api/`, so nothing has to change in the pages themselves. Anything
 * that is not an `/api/` request is passed through to the real `fetch`
 * untouched, which keeps Supabase and asset loading honest.
 *
 * Guarded on `import.meta.env.DEV`, which Vite compiles to `false` in a
 * production build — the call site in `main.tsx` is behind the same check, so
 * none of this reaches `dist`. Delete this file and the two call sites once a
 * real backend is available.
 */

type Json = Record<string, unknown> | unknown[]

const json = (body: Json, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })

/* ── Fixture data ───────────────────────────────────────────────────────── */

const iso = (daysAgo: number, hour = 9) => {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  d.setHours(hour, (daysAgo * 7) % 60, 0, 0)
  return d.toISOString()
}

type MockUser = {
  id: string
  email: string
  full_name: string
  role: "clinician" | "admin" | "super_admin"
  status: "approved" | "pending" | "rejected" | "deleted"
  phone: string | null
  specialization: string | null
  license_number: string | null
  clinic_id: string | null
  last_login_at: string | null
  created_at: string
  updated_at: string
  avatar_url: string | null
}

const USERS: MockUser[] = [
  { id: "u1", email: "superadmin@aura-dx.xyz", full_name: "Preview Admin", role: "super_admin", status: "approved", phone: null, specialization: null, license_number: null, clinic_id: null, last_login_at: iso(0, 8), created_at: iso(180), updated_at: iso(0, 8), avatar_url: null },
  { id: "u2", email: "m.delacruz@auradx.clinic", full_name: "Dr. Maria Cristina Santos-Delacruz", role: "clinician", status: "approved", phone: "+63 917 555 0142", specialization: "Pulmonology", license_number: "PRC 104382", clinic_id: "c1", last_login_at: iso(0, 7), created_at: iso(120), updated_at: iso(1), avatar_url: null },
  { id: "u3", email: "r.villanueva@auradx.clinic", full_name: "Dr. Rafael Villanueva", role: "clinician", status: "approved", phone: "+63 918 555 0198", specialization: "Internal Medicine", license_number: "PRC 118204", clinic_id: "c1", last_login_at: iso(1, 14), created_at: iso(96), updated_at: iso(2), avatar_url: null },
  { id: "u4", email: "a.merano@auradx.clinic", full_name: "Dr. Andrea Merano", role: "clinician", status: "approved", phone: "+63 919 555 0110", specialization: "Pediatrics", license_number: "PRC 127715", clinic_id: "c1", last_login_at: iso(2, 10), created_at: iso(74), updated_at: iso(3), avatar_url: null },
  { id: "u5", email: "j.primus@auradx.clinic", full_name: "Jose Primus", role: "clinician", status: "pending", phone: "+63 920 555 0177", specialization: "Respiratory Therapy", license_number: null, clinic_id: null, last_login_at: null, created_at: iso(1, 21), updated_at: iso(1, 21), avatar_url: null },
  { id: "u6", email: "l.santiago@auradx.clinic", full_name: "Lorraine Santiago", role: "clinician", status: "pending", phone: null, specialization: null, license_number: null, clinic_id: null, last_login_at: null, created_at: iso(3, 16), updated_at: iso(3, 16), avatar_url: null },
  { id: "u7", email: "k.bautista@auradx.clinic", full_name: "Dr. Kristine Bautista-Imperial", role: "clinician", status: "rejected", phone: "+63 917 555 0163", specialization: "Family Medicine", license_number: "PRC 99812", clinic_id: null, last_login_at: null, created_at: iso(40), updated_at: iso(38), avatar_url: null },
]

type MockPatient = {
  id: string
  full_name: string
  date_of_birth: string
  gender: string
  age_bracket: string
  phone: string | null
  email: string | null
  created_at: string
}

const PATIENTS: MockPatient[] = [
  { id: "p1", full_name: "Elena Consuelo Magsaysay-Rivera", date_of_birth: "1958-04-12", gender: "Female", age_bracket: "60-69", phone: "+63 917 000 1122", email: null, created_at: iso(30) },
  { id: "p2", full_name: "Rogelio Bautista", date_of_birth: "1971-09-03", gender: "Male", age_bracket: "50-59", phone: "+63 918 000 3344", email: "rogelio.b@example.com", created_at: iso(24) },
  { id: "p3", full_name: "Corazon Alvarez-Tiong", date_of_birth: "1949-01-27", gender: "Female", age_bracket: "70-79", phone: null, email: null, created_at: iso(21) },
  { id: "p4", full_name: "Emmanuel del Rosario", date_of_birth: "1985-06-18", gender: "Male", age_bracket: "30-39", phone: "+63 919 000 5566", email: null, created_at: iso(18) },
  { id: "p5", full_name: "Marilou San Agustin", date_of_birth: "1963-11-05", gender: "Female", age_bracket: "60-69", phone: "+63 920 000 7788", email: null, created_at: iso(14) },
  { id: "p6", full_name: "Josefina Pangilinan-Cruz", date_of_birth: "1992-02-21", gender: "Female", age_bracket: "20-29", phone: null, email: null, created_at: iso(9) },
  { id: "p7", full_name: "Bernardo Sibayan", date_of_birth: "1976-07-30", gender: "Male", age_bracket: "40-49", phone: "+63 917 000 9900", email: null, created_at: iso(6) },
  { id: "p8", full_name: "Amihan Locsin", date_of_birth: "1969-12-09", gender: "Female", age_bracket: "50-59", phone: null, email: null, created_at: iso(2) },
]

type RawScreening = {
  id: string
  patient_name: string
  clinician_name: string
  respiratory_result: string | null
  respiratory_confidence: number | null
  status: string
  reviewed_by_name: string | null
  created_at: string
}

/* The full shape ScreeningDetail expects. Its probability bars are guarded by
   `if (!screening?.respiratory_probabilities) return null`, so a screening
   without them renders a blank page rather than a degraded one — every field
   below has to be present, not just the ones the list views read. */
type MockScreening = RawScreening & {
  patient_id: string | null
  clinic_id: string | null
  clinician_id: string | null
  audio_file_path: string | null
  audio_duration_sec: number | null
  respiratory_probabilities: Record<string, number> | null
  model_version: string
  reviewed_by: string | null
  reviewed_at: string | null
  review_notes: string | null
  updated_at: string
}

/* Class order mirrors inference_service.py, so the probability bars render in
   the same sequence they would against the real service. */
const RESP_CLASSES = ["Healthy", "Pneumonia", "COPD"]

function probabilityMap(
  order: string[],
  winner: string | null,
  confidence: number | null,
): Record<string, number> | null {
  if (!winner || confidence === null) return null
  const rest = Number(((1 - confidence) / (order.length - 1)).toFixed(4))
  const out: Record<string, number> = {}
  for (const cls of order) out[cls] = cls === winner ? confidence : rest
  return out
}

/* Distribution is deliberately uneven — mostly Healthy with a few COPD and
   pneumonia hits — because that is what the dashboard's stat tiles and the
   result chips need in order to be judged at a realistic density. */
const RAW_SCREENINGS: RawScreening[] = [
  { id: "s1", patient_name: "Elena Consuelo Magsaysay-Rivera", clinician_name: "Dr. Maria Cristina Santos-Delacruz", respiratory_result: "COPD", respiratory_confidence: 0.81, status: "reviewed", reviewed_by_name: "Dr. Maria Cristina Santos-Delacruz", created_at: iso(0, 8) },
  { id: "s2", patient_name: "Amihan Locsin", clinician_name: "Dr. Andrea Merano", respiratory_result: "Healthy", respiratory_confidence: 0.93, status: "reviewed", reviewed_by_name: "Dr. Andrea Merano", created_at: iso(0, 9) },
  { id: "s3", patient_name: "Bernardo Sibayan", clinician_name: "Dr. Rafael Villanueva", respiratory_result: "Pneumonia", respiratory_confidence: 0.72, status: "pending_review", reviewed_by_name: null, created_at: iso(1, 11) },
  { id: "s4", patient_name: "Marilou San Agustin", clinician_name: "Dr. Maria Cristina Santos-Delacruz", respiratory_result: "COPD", respiratory_confidence: 0.68, status: "reviewed", reviewed_by_name: "Dr. Maria Cristina Santos-Delacruz", created_at: iso(1, 15) },
  { id: "s5", patient_name: "Emmanuel del Rosario", clinician_name: "Dr. Andrea Merano", respiratory_result: "Healthy", respiratory_confidence: 0.95, status: "reviewed", reviewed_by_name: "Dr. Andrea Merano", created_at: iso(2, 10) },
  { id: "s6", patient_name: "Josefina Pangilinan-Cruz", clinician_name: "Dr. Rafael Villanueva", respiratory_result: "Healthy", respiratory_confidence: 0.91, status: "reviewed", reviewed_by_name: "Dr. Rafael Villanueva", created_at: iso(3, 14) },
  { id: "s7", patient_name: "Corazon Alvarez-Tiong", clinician_name: "Dr. Maria Cristina Santos-Delacruz", respiratory_result: "COPD", respiratory_confidence: 0.71, status: "pending_review", reviewed_by_name: null, created_at: iso(4, 9) },
  { id: "s8", patient_name: "Rogelio Bautista", clinician_name: "Dr. Andrea Merano", respiratory_result: "COPD", respiratory_confidence: 0.76, status: "reviewed", reviewed_by_name: "Dr. Andrea Merano", created_at: iso(5, 16) },
  { id: "s9", patient_name: "Amihan Locsin", clinician_name: "Dr. Rafael Villanueva", respiratory_result: "Healthy", respiratory_confidence: 0.97, status: "reviewed", reviewed_by_name: "Dr. Rafael Villanueva", created_at: iso(7, 10) },
  { id: "s10", patient_name: "Bernardo Sibayan", clinician_name: "Dr. Maria Cristina Santos-Delacruz", respiratory_result: "Pneumonia", respiratory_confidence: 0.58, status: "pending_review", reviewed_by_name: null, created_at: iso(9, 13) },
  { id: "s11", patient_name: "Marilou San Agustin", clinician_name: "Dr. Andrea Merano", respiratory_result: "Healthy", respiratory_confidence: 0.88, status: "reviewed", reviewed_by_name: "Dr. Andrea Merano", created_at: iso(12, 11) },
  { id: "s12", patient_name: "Elena Consuelo Magsaysay-Rivera", clinician_name: "Dr. Rafael Villanueva", respiratory_result: "COPD", respiratory_confidence: 0.84, status: "reviewed", reviewed_by_name: "Dr. Rafael Villanueva", created_at: iso(16, 15) },
]

/* Expand the readable fixtures above into the full record shape, deriving the
   ids and probability maps rather than hand-writing twelve near-identical
   objects. */
const SCREENINGS: MockScreening[] = RAW_SCREENINGS.map((s, i) => {
  const patient = PATIENTS.find((p) => p.full_name === s.patient_name)
  const clinician = USERS.find((u) => u.full_name === s.clinician_name)
  const reviewer = USERS.find((u) => u.full_name === s.reviewed_by_name)
  return {
    ...s,
    patient_id: patient?.id ?? null,
    clinic_id: "c1",
    clinician_id: clinician?.id ?? null,
    audio_file_path: `/recordings/${s.id}.wav`,
    audio_duration_sec: Number((3.2 + (i % 4) * 0.7).toFixed(1)),
    respiratory_probabilities: probabilityMap(RESP_CLASSES, s.respiratory_result, s.respiratory_confidence),
    model_version: "2.5.0-multi",
    reviewed_by: reviewer?.id ?? null,
    reviewed_at: s.reviewed_by_name ? s.created_at : null,
    review_notes: s.reviewed_by_name ? "Reviewed during the thesis defence demo." : null,
    updated_at: s.created_at,
  }
})

/* ── Router ────────────────────────────────────────────────────────────── */

const randomOf = <T,>(list: T[]): T => list[Math.floor(Math.random() * list.length)]

function route(input: string, method: string): Response | null {
  const url = new URL(input, window.location.origin)
  const path = url.pathname
  const q = url.searchParams

  if (!path.startsWith("/api/")) return null

  /* Users */
  if (path === "/api/users" && method === "GET") return json(USERS)
  if (/^\/api\/users\/[^/]+$/.test(path)) {
    const id = path.split("/").pop()
    if (method === "PATCH") return json(USERS.find((u) => u.id === id) ?? { id })
    if (method === "DELETE") return json({ id })
  }

  if (path === "/api/metrics/summary") {
    return json({ total_requests: 128, total_screenings: SCREENINGS.length, pending_review: SCREENINGS.filter((s) => s.status === "pending_review").length })
  }

  /* Screenings */
  if (path === "/api/screenings" && method === "GET") {
    const patientId = q.get("patient_id")
    if (patientId) {
      const patient = PATIENTS.find((p) => p.id === patientId)
      return json(SCREENINGS.filter((s) => s.patient_name === patient?.full_name))
    }
    return json(SCREENINGS)
  }
  if (path === "/api/screenings" && method === "POST") {
    const patientId = q.get("patient_id")
    const patient = PATIENTS.find((p) => p.id === patientId) ?? randomOf(PATIENTS)
    const confidence = Number((0.6 + Math.random() * 0.38).toFixed(2))
    const result = randomOf(["Healthy", "COPD", "Pneumonia"])
    const now = new Date().toISOString()
    const created: MockScreening = {
      id: `s${SCREENINGS.length + 1}`,
      patient_name: patient.full_name,
      patient_id: patient.id,
      clinician_name: "Preview Clinician",
      clinician_id: "u2",
      clinic_id: "c1",
      respiratory_result: result,
      respiratory_confidence: confidence,
      respiratory_probabilities: probabilityMap(RESP_CLASSES, result, confidence),
      status: "pending_review",
      reviewed_by_name: null,
      reviewed_by: null,
      reviewed_at: null,
      review_notes: null,
      model_version: "2.5.0-multi",
      audio_file_path: "/recordings/upload.wav",
      audio_duration_sec: 3.4,
      created_at: now,
      updated_at: now,
    }
    SCREENINGS.unshift(created)
    return json(created, 201)
  }
  if (/^\/api\/screenings\/[^/]+\/(pdf|review)$/.test(path)) {
    if (path.endsWith("/pdf")) return json({ detail: "PDF generation is not available in the dev mock." }, 501)
    return json({ status: "reviewed", reviewed_by_name: "Preview Clinician" })
  }
  if (/^\/api\/screenings\/[^/]+$/.test(path)) {
    const id = path.split("/").pop()
    return json(SCREENINGS.find((s) => s.id === id) ?? SCREENINGS[0])
  }

  /* Patients */
  if (path === "/api/patients" && method === "GET") return json(PATIENTS)
  if (path === "/api/patients" && method === "POST") {
    const created: MockPatient = {
      id: `p${PATIENTS.length + 1}`,
      full_name: "New Mock Patient",
      date_of_birth: "1990-01-01",
      gender: "Unspecified",
      age_bracket: "30-39",
      phone: null,
      email: null,
      created_at: new Date().toISOString(),
    }
    PATIENTS.unshift(created)
    return json(created, 201)
  }
  if (/^\/api\/patients\/[^/]+$/.test(path)) {
    const id = path.split("/").pop()
    if (method === "PATCH" || method === "DELETE") return json(PATIENTS.find((p) => p.id === id) ?? { id })
    return json(PATIENTS.find((p) => p.id === id) ?? PATIENTS[0])
  }

  /* Audio + OTP — enough to stop the UI erroring, not enough to fake a model. */
  if (path === "/api/audio/upload") {
    return json({ detail: "Audio inference is not available in the dev mock." }, 501)
  }
  if (path === "/api/auth/send-otp") return json({ sent: true })
  if (path === "/api/auth/verify-otp") return json({ verified: true })

  /* Anything else under /api/ — answer 501 rather than hitting a dead socket. */
  return json({ detail: `dev mock has no route for ${method} ${path}` }, 501)
}

let installed = false

export function installDevApiMock(): void {
  if (import.meta.env.VITE_DISABLE_API_MOCK === "true") return
  if (!import.meta.env.DEV || installed || typeof window === "undefined") return
  installed = true

  const realFetch = window.fetch.bind(window)

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const href =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase()

    try {
      const mocked = route(href, method)
      if (mocked) return mocked
    } catch {
      /* fall through to the real fetch */
    }
    return realFetch(input, init)
  }
}
