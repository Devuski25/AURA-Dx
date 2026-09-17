import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { Patients } from "@/pages/Patients"
import { Screenings } from "@/pages/Screenings"

export function PatientRecords({
  defaultTab = "patients",
}: {
  defaultTab?: "patients" | "screenings"
}) {
  return (
    <div className="space-y-6">
      {/* B11: single page title — the tab strip carries the section switch,
          so neither the page nor the tabs repeat "Patient Records" again. */}
      <div>
        <h1 className="font-display text-2xl font-bold text-aura-ink">Patient Records</h1>
        <p className="text-aura-muted">Manage patient records and screening history</p>
      </div>

      <Tabs defaultValue={defaultTab}>
        <TabsList
          aria-label="Patient record sections"
          className="inline-flex h-11 items-center gap-1 rounded-xl border border-aura-border-soft bg-aura-sage/60 p-1"
        >
          <TabsTrigger
            value="patients"
            className={cn(
              "h-9 rounded-lg px-4 text-sm font-semibold text-aura-muted transition-colors",
              "hover:text-aura-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-brand",
              "data-[state=active]:bg-white data-[state=active]:text-aura-ink data-[state=active]:shadow-aura-sm"
            )}
          >
            Patients
          </TabsTrigger>
          <TabsTrigger
            value="screenings"
            className={cn(
              "h-9 rounded-lg px-4 text-sm font-semibold text-aura-muted transition-colors",
              "hover:text-aura-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-brand",
              "data-[state=active]:bg-white data-[state=active]:text-aura-ink data-[state=active]:shadow-aura-sm"
            )}
          >
            Screening Records
          </TabsTrigger>
        </TabsList>
        <TabsContent value="patients" className="mt-5">
          <Patients embedded />
        </TabsContent>
        <TabsContent value="screenings" className="mt-5">
          <Screenings embedded />
        </TabsContent>
      </Tabs>
    </div>
  )
}
