import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Patients } from "@/pages/Patients"
import { Screenings } from "@/pages/Screenings"

export function PatientRecords({
  defaultTab = "patients",
}: {
  defaultTab?: "patients" | "screenings"
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-aura-ink">Patient Records</h1>
        <p className="text-aura-muted">Manage patient records and screening history</p>
      </div>

      <Tabs defaultValue={defaultTab}>
        <TabsList>
          <TabsTrigger value="patients">Patients</TabsTrigger>
          <TabsTrigger value="screenings">Screening Records</TabsTrigger>
        </TabsList>
        <TabsContent value="patients">
          <Patients embedded />
        </TabsContent>
        <TabsContent value="screenings">
          <Screenings embedded />
        </TabsContent>
      </Tabs>
    </div>
  )
}
