"use client"

import { useState, useEffect } from "react"
import { Loader2, Search, Edit, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form"
import { getResultBadge } from "@/lib/badge-helpers"
import { Checkbox } from "@/components/ui/checkbox"
import { z } from "zod"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"

const patientSchema = z.object({
  full_name: z.string().min(2, "Name must be at least 2 characters"),
  date_of_birth: z.string().min(1, "Date of birth is required"),
  gender: z.enum(["male", "female", "other"]),
  smoking_history: z.boolean(),
  pack_years: z.number().optional(),
  past_respiratory_diseases: z.array(z.string()),
  symptoms: z.array(z.string()),
})

type PatientFormData = z.infer<typeof patientSchema>

export function Patients() {
  const { user } = useAuth()
  const [patients, setPatients] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [genderFilter, setGenderFilter] = useState("all")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingPatient, setEditingPatient] = useState<any | null>(null)
  const [deletingPatient, setDeletingPatient] = useState<any | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)

  const form = useForm<PatientFormData>({
    resolver: zodResolver(patientSchema),
    defaultValues: {
      full_name: "",
      date_of_birth: "",
      gender: "male",
      smoking_history: false,
      pack_years: undefined,
      past_respiratory_diseases: [],
      symptoms: [],
    },
  })

  useEffect(() => {
    fetchPatients()
  }, [user])

  const fetchPatients = async () => {
    if (!user) return
    setLoading(true)
    try {
      let query = supabase
        .from("patient_list_view")
        .select("*")

      if (user.role === "admin" && user.clinic_id) {
        query = query.eq("clinic_id", user.clinic_id)
      }

      const { data: patientsData, error: patientsError } = await query.order("created_at", { ascending: false })
      if (patientsError) throw patientsError

      const { data: allScreenings } = await supabase
        .from("screening_history_view")
        .select("patient_id, tb_result, respiratory_result, created_at")
        .order("created_at", { ascending: false })

      const latestScreenings: Record<string, any> = {}
      if (allScreenings) {
        for (const s of allScreenings) {
          if (!latestScreenings[s.patient_id]) {
            latestScreenings[s.patient_id] = s
          }
        }
      }

      setPatients((patientsData || []).map(p => ({
        ...p,
        latest_screening: latestScreenings[p.id] || null
      })))
    } catch (error) {
      console.error("Error fetching patients:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (data: PatientFormData) => {
    try {
      if (editingPatient) {
        const { error } = await supabase
          .from("patients")
          .update({
            full_name: data.full_name,
            date_of_birth: data.date_of_birth,
            gender: data.gender,
            smoking_history: data.smoking_history,
            pack_years: data.pack_years,
            past_respiratory_diseases: data.past_respiratory_diseases,
            symptoms: data.symptoms,
          })
          .eq("id", editingPatient.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from("patients")
          .insert({
            ...data,
            clinician_id: user?.id,
            clinic_id: user?.clinic_id,
          })
        if (error) throw error
      }
      fetchPatients()
      setDialogOpen(false)
      form.reset()
    } catch (error) {
      console.error("Error saving patient:", error)
      toast.error("Failed to save patient")
    }
  }

  const handleDelete = async () => {
    if (!deletingPatient) return
    try {
      const { error } = await supabase
        .from("patients")
        .delete()
        .eq("id", deletingPatient.id)
      if (error) throw error
      fetchPatients()
    } catch (error) {
      console.error("Error deleting patient:", error)
      toast.error("Failed to delete patient")
    } finally {
      setDeleteConfirmOpen(false)
      setDeletingPatient(null)
    }
  }

  const filteredPatients = patients
    .filter(p => {
      if (search) {
        const searchLower = search.toLowerCase()
        return p.full_name.toLowerCase().includes(searchLower)
      }
      return true
    })
    .filter(p => {
      if (genderFilter === "all") return true
      return p.gender === genderFilter
    })

  const openEditDialog = (patient: any) => {
    setEditingPatient(patient)
    form.reset({
      full_name: patient.full_name,
      date_of_birth: patient.date_of_birth,
      gender: patient.gender,
      smoking_history: patient.smoking_history || false,
      pack_years: patient.pack_years,
      past_respiratory_diseases: patient.past_respiratory_diseases || [],
      symptoms: patient.symptoms || [],
    })
    setDialogOpen(true)
  }

  const openCreateDialog = () => {
    setEditingPatient(null)
    form.reset({
      full_name: "",
      date_of_birth: "",
      gender: "male",
      smoking_history: false,
      pack_years: undefined,
      past_respiratory_diseases: [],
      symptoms: [],
    })
    setDialogOpen(true)
  }

  const confirmDelete = (patient: any) => {
    setDeletingPatient(patient)
    setDeleteConfirmOpen(true)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Patients</h1>
          <p className="text-muted-foreground">Manage patient records and screenings</p>
        </div>
        
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search patients..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={genderFilter} onValueChange={setGenderFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Gender" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="female">Female</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Patients Table */}
      <Card>
        <CardHeader>
          <CardTitle>Patients Records ({filteredPatients.length} of {patients.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : filteredPatients.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No patients found.
            </div>
          ) : (
            <div className="overflow-x-auto overflow-y-auto max-h-[500px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Age & Gender</TableHead>
                    <TableHead>Smoking</TableHead>
                    <TableHead>Conditions</TableHead>
                    <TableHead>Latest Result</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPatients.map(patient => (
                    <TableRow key={patient.id}>
                      <TableCell>
                        <div className="font-medium">{patient.full_name}</div>
                        <div className="text-xs text-muted-foreground">{patient.clinician_name}</div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium">{patient.age_bracket}</div>
                          <div className="text-xs text-muted-foreground capitalize">{patient.gender}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {patient.smoking_history ? (
                          <Badge variant="secondary">
                            {patient.pack_years ? `${patient.pack_years} pack-years` : "Yes"}
                          </Badge>
                        ) : (
                          <Badge variant="outline">Non-smoker</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {(patient.past_respiratory_diseases || []).slice(0, 2).map((d: string, i: number) => (
                            <Badge key={i} variant="outline">{d}</Badge>
                          ))}
                          {(patient.past_respiratory_diseases || []).length > 2 && (
                            <Badge variant="outline">+{(patient.past_respiratory_diseases || []).length - 2} more</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {getResultBadge(
                          patient.latest_screening?.tb_result || null,
                          patient.latest_screening?.respiratory_result || null
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(patient.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button variant="ghost" size="icon" onClick={() => openEditDialog(patient)}>
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => confirmDelete(patient)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Patient Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingPatient ? "Edit Patient" : "Add New Patient"}</DialogTitle>
            <DialogDescription>
              {editingPatient ? "Update patient information" : "Create a new patient record"}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="full_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Full Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Dr. John Smith" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="date_of_birth"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date of Birth</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="gender"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Gender</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select gender" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="male">Male</SelectItem>
                          <SelectItem value="female">Female</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="pack_years"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Pack Years (if smoker)</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.1" placeholder="e.g., 20" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="smoking_history"
                render={({ field }) => (
                  <FormItem className="flex items-center space-x-2">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onChange={(e) => field.onChange(e.target.checked)}
                      />
                    </FormControl>
                    <FormLabel>Smoking History</FormLabel>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="past_respiratory_diseases"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Past Respiratory Diseases (comma separated)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Asthma, COPD, Bronchitis"
                        value={field.value.join(", ")}
                        onChange={e => field.onChange(e.target.value.split(",").map(s => s.trim()).filter(Boolean))}
                      />
                    </FormControl>
                    <FormDescription>Separate with commas</FormDescription>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="symptoms"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Current Symptoms (comma separated)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Cough, Fever, Shortness of breath"
                        value={field.value.join(", ")}
                        onChange={e => field.onChange(e.target.value.split(",").map(s => s.trim()).filter(Boolean))}
                      />
                    </FormControl>
                    <FormDescription>Separate with commas</FormDescription>
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting ? "Saving..." : editingPatient ? "Update" : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Patient</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {deletingPatient?.full_name}? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}