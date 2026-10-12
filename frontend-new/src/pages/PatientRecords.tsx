import { Screenings } from "@/pages/Screenings"

/**
 * Patient Records now shows screening records only.
 *
 * The Patients tab and its `/dashboard/patients` route are gone, which leaves a
 * single tab and makes the tab strip redundant — a one-item segmented control
 * implies a choice that no longer exists. Both `/dashboard/patient-records` and
 * `/dashboard/screenings` still resolve here, so the Dashboard's links keep
 * working.
 *
 * The page header is `Screenings`' own PageBanner (the same one the Dashboard
 * uses), so this wrapper adds no markup of its own — it exists only to hold the
 * route-facing component.
 */
export function PatientRecords() {
  return <Screenings />
}