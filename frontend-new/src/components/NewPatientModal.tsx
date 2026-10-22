"use client"

import * as React from "react"
import { useState } from "react"
import { Calendar } from "lucide-react"
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
  FormDescription,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { z } from "zod"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/useAuth"
import { apiFetch } from "@/lib/api"
import { invalidate } from "@/hooks/useCachedData"

const PAST_DISEASES = [
  "Asthma",
  "COPD",
  "Bronchitis",
  "Pneumonia",
  "Lung Cancer",
  "Pulmonary Fibrosis",
  "Sleep Apnea",
  "Cystic Fibrosis",
  "Other",
  "None of the above",
]

const SYMPTOMS = [
  "Cough",
  "Fever",
  "Shortness of breath",
  "Chest pain",
  "Wheezing",
  "Fatigue",
  "Weight loss",
  "Hemoptysis (coughing blood)",
  "Sore throat",
  "Runny nose",
  "None of the above",
]

const patientSchema = z.object({
  full_name: z.string().min(2, "Name must be at least 2 characters"),
  date_of_birth: z.string().min(1, "Date of birth is required"),
  gender: z.enum(["male", "female", "other"]),
  smoking_history: z.boolean(),
  past_respiratory_diseases: z.array(z.string()).min(1, "Select at least one condition"),
  symptoms: z.array(z.string()).min(1, "Select at least one symptom"),
})

type PatientFormData = z.infer<typeof patientSchema>

interface NewPatientModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPatientCreated: (patient: { id: string; full_name: string }, formData?: PatientFormData) => void
  initialData?: PatientFormData
  /** When set, the form PATCHes this patient instead of POSTing a new one. */
  editingPatientId?: string | null
}

export function NewPatientModal({ open, onOpenChange, onPatientCreated, initialData, editingPatientId }: NewPatientModalProps) {
  const { user, accessToken } = useAuth()
  const [age, setAge] = useState<number | null>(null)
  const [ageBracket, setAgeBracket] = useState<string>("")

  const form = useForm<PatientFormData>({
    resolver: zodResolver(patientSchema),
    defaultValues: initialData || {
      full_name: "",
      date_of_birth: "",
      gender: "male",
      smoking_history: false,
      past_respiratory_diseases: [] as string[],
      symptoms: [] as string[],
    },
  })

  React.useEffect(() => {
    if (initialData) {
      form.reset(initialData)
    }
  }, [initialData])

  const dobValue = form.watch("date_of_birth")

  React.useEffect(() => {
    if (dobValue) {
      const birthDate = new Date(dobValue)
      const today = new Date()
      let ageCalc = today.getFullYear() - birthDate.getFullYear()
      const monthDiff = today.getMonth() - birthDate.getMonth()
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        ageCalc--
      }
      setAge(ageCalc)
      if (ageCalc < 18) setAgeBracket("pediatric")
      else if (ageCalc < 65) setAgeBracket("adult")
      else setAgeBracket("geriatric")
    } else {
      setAge(null)
      setAgeBracket("")
    }
  }, [dobValue])

  const isEditing = Boolean(editingPatientId)

  const onSubmit = async (data: PatientFormData) => {
    if (!user || !accessToken) {
      toast.error("Session not ready. Please wait or log out and back in.")
      return
    }

    try {
      /* Editing updates the existing record rather than creating a second
         patient under the same name. The route is chosen here rather than
         passed in, so the caller cannot accidentally POST a duplicate by
         forgetting to clear editingPatientId. */
      const res = isEditing
        ? await apiFetch(`/api/patients/${editingPatientId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
          })
        : await apiFetch("/api/patients", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...data,
              clinician_id: user.id,
              clinic_id: user.clinic_id,
            }),
          })

      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.detail || (isEditing ? "Failed to update patient" : "Failed to create patient"))
      }

      const patient = await res.json()
      // Drop cached patient/screening lists so all views refetch fresh
      invalidate("patients")
      invalidate("patient-records")
      invalidate("screenings")
      onPatientCreated({ id: patient.id, full_name: patient.full_name }, data)
      form.reset()
      onOpenChange(false)
    } catch (error: any) {
      console.error(isEditing ? "Error updating patient:" : "Error creating patient:", error)
      toast.error(
        (isEditing ? "Failed to update patient: " : "Failed to create patient: ")
        + (error instanceof Error ? error.message : "Unknown error")
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl text-aura-text">
          <DialogHeader>
            <DialogTitle className="text-aura-text">
              {isEditing ? "Edit Patient Details" : "New Patient Screening"}
            </DialogTitle>
            <DialogDescription className="text-aura-muted">
              {isEditing
                ? "Update this patient's details. Existing screening results are not changed."
                : "Enter patient details for a new breathing screening."}
            </DialogDescription>
          </DialogHeader>
        <Form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="full_name"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel className="text-aura-text">Full Name</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Dr. John Smith"
                        autoComplete="name"
                        className="text-[#333333] placeholder:text-[#6b7f75]"
                        {...field}
                      />
                    </FormControl>
                    {fieldState.error && <FormMessage>{fieldState.error.message}</FormMessage>}
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="date_of_birth"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel className="text-aura-text">Date of Birth</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-aura-muted" />
                        <Input
                          type="date"
                          className="pl-10 text-[#333333] placeholder:text-[#6b7f75]"
                          autoComplete="bday"
                          max={new Date().toISOString().split("T")[0]}
                          onWheel={(e) => e.currentTarget.blur()}
                          {...field}
                        />
                      </div>
                    </FormControl>
                    {fieldState.error && <FormMessage>{fieldState.error.message}</FormMessage>}
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="gender"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel className="text-aura-text">Gender</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="text-[#333333]">
                          <SelectValue placeholder="Select gender" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="male">Male</SelectItem>
                        <SelectItem value="female">Female</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                    {fieldState.error && <FormMessage>{fieldState.error.message}</FormMessage>}
                  </FormItem>
                )}
              />
              <div>
                <p className="mb-2 text-sm font-medium text-aura-text">Age</p>
                <Input
                  type="text"
                  readOnly
                  value={age !== null ? `${age} years (${ageBracket})` : ""}
                  placeholder="Derived from date of birth"
                  className="h-9 bg-aura-surface-alt text-[#333333] placeholder:text-[#6b7f75]"
                />
              </div>
            </div>

            <FormField
              control={form.control}
              name="smoking_history"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel className="text-aura-text">Smoking</FormLabel>
                  <FormControl>
                    <div className="flex gap-6 pt-1">
                      <label className="flex cursor-pointer items-center gap-2 text-[#333333]">
                        <input
                          type="radio"
                          checked={field.value === true}
                          onChange={() => field.onChange(true)}
                          className="h-4 w-4"
                        />
                        <span className="text-sm">Yes</span>
                      </label>
                      <label className="flex cursor-pointer items-center gap-2 text-[#333333]">
                        <input
                          type="radio"
                          checked={field.value === false}
                          onChange={() => field.onChange(false)}
                          className="h-4 w-4"
                        />
                        <span className="text-sm">No</span>
                      </label>
                    </div>
                  </FormControl>
                  {fieldState.error && <FormMessage>{fieldState.error.message}</FormMessage>}
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="past_respiratory_diseases"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel className="text-aura-text">Past Respiratory Diseases</FormLabel>
                  <FormControl>
                    <div className="flex flex-wrap gap-1.5">
                      {PAST_DISEASES.map((disease) => (
                        <label
                          key={disease}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-sm text-aura-text transition-colors cursor-pointer",
                            field.value.includes(disease)
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-aura-border hover-tap:border-primary/50"
                          )}
                        >
                          <Checkbox

                            checked={field.value.includes(disease)}
                            onCheckedChange={(checked) => {
                              if (disease === "None of the above") {
                                field.onChange(checked === true ? ["None of the above"] : [])
                              } else {
                                let newValue = checked === true
                                  ? [...field.value, disease]
                                  : field.value.filter((d: string) => d !== disease)
                                field.onChange(newValue.filter((d: string) => d !== "None of the above"))
                              }
                            }}
                            className="h-3 w-3"
                          />
                          {disease}
                        </label>
                      ))}
                    </div>
                  </FormControl>
                  <FormDescription className="text-aura-muted">Select all that apply</FormDescription>
                  {fieldState.error && <FormMessage>{fieldState.error.message}</FormMessage>}
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="symptoms"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel className="text-aura-text">Current Symptoms</FormLabel>
                  <FormControl>
                    <div className="flex flex-wrap gap-1.5">
                      {SYMPTOMS.map((symptom) => (
                        <label
                          key={symptom}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-sm text-aura-text transition-colors cursor-pointer",
                            field.value.includes(symptom)
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-aura-border hover-tap:border-primary/50"
                          )}
                        >
                          <Checkbox

                            checked={field.value.includes(symptom)}
                            onCheckedChange={(checked) => {
                              if (symptom === "None of the above") {
                                field.onChange(checked === true ? ["None of the above"] : [])
                              } else {
                                let newValue = checked === true
                                  ? [...field.value, symptom]
                                  : field.value.filter((s: string) => s !== symptom)
                                field.onChange(newValue.filter((s: string) => s !== "None of the above"))
                              }
                            }}
                            className="h-3 w-3"
                          />
                          {symptom}
                        </label>
                      ))}
                    </div>
                  </FormControl>
                  <FormDescription className="text-aura-muted">Select all current symptoms</FormDescription>
                  {fieldState.error && <FormMessage>{fieldState.error.message}</FormMessage>}
                </FormItem>
              )}
            />

            <DialogFooter className="gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "Creating…" : "Create Patient & Continue"}
              </Button>
            </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
