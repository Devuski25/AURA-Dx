"use client"

import * as React from "react"
import { useState } from "react"
import { X, Calendar } from "lucide-react"
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

const PAST_DISEASES = [
  "Asthma",
  "COPD",
  "Bronchitis",
  "Pneumonia",
  "Tuberculosis",
  "Lung Cancer",
  "Pulmonary Fibrosis",
  "Sleep Apnea",
  "Cystic Fibrosis",
  "Other",
]

const SYMPTOMS = [
  "Cough",
  "Fever",
  "Shortness of breath",
  "Chest pain",
  "Wheezing",
  "Fatigue",
  "Weight loss",
  "Night sweats",
  "Hemoptysis (coughing blood)",
  "Sore throat",
  "Runny nose",
]

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

interface NewPatientModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPatientCreated: (patient: { id: string; full_name: string }) => void
}

export function NewPatientModal({ open, onOpenChange, onPatientCreated }: NewPatientModalProps) {
  const { user, accessToken } = useAuth()
  const [age, setAge] = useState<number | null>(null)
  const [ageBracket, setAgeBracket] = useState<string>("")

  const form = useForm<PatientFormData>({
    resolver: zodResolver(patientSchema),
    defaultValues: {
      full_name: "",
      date_of_birth: "",
      gender: "male",
      smoking_history: false,
      pack_years: undefined,
      past_respiratory_diseases: [] as string[],
      symptoms: [] as string[],
    },
  })

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

  const onSubmit = async (data: PatientFormData) => {
    if (!user || !accessToken) return

    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || "http://localhost:8001"}/api/patients`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          ...data,
          pack_years: data.smoking_history ? data.pack_years : null,
          clinician_id: user.id,
          clinic_id: user.clinic_id,
        }),
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.detail || "Failed to create patient")
      }

      const patient = await res.json()
      onPatientCreated({ id: patient.id, full_name: patient.full_name })
      form.reset()
      onOpenChange(false)
    } catch (error: any) {
      console.error("Error creating patient:", error)
      toast.error("Failed to create patient: " + (error instanceof Error ? error.message : "Unknown error"))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            New Patient Screening
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onOpenChange(false)}
              className="h-8 w-8"
            >
              <X className="h-4 w-4" />
            </Button>
          </DialogTitle>
          <DialogDescription>
            Enter patient details for a new cough screening. All fields are required unless marked optional.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
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
                      <div className="relative">
                        <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          type="date"
                          className="pl-10"
                          max={new Date().toISOString().split("T")[0]}
                          {...field}
                        />
                      </div>
                    </FormControl>
                    {age !== null && (
                      <FormDescription className="flex items-center gap-2 text-primary">
                        <Calendar className="h-3.5 w-3.5" />
                        Auto-calculated age: <strong>{age} years</strong> ({ageBracket})
                      </FormDescription>
                    )}
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
                    <FormLabel>Pack Years {form.watch("smoking_history") ? "" : "(if smoker)"}</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.1"
                        placeholder="e.g., 20"
                        disabled={!form.watch("smoking_history")}
                        value={field.value ?? ""}
                        onChange={(e) => {
                          const val = e.target.value
                          field.onChange(val === "" ? undefined : parseFloat(val))
                        }}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        name={field.name}
                      />
                    </FormControl>
                    <FormDescription>Number of packs per day × years smoked</FormDescription>
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
                  <FormLabel className="cursor-pointer">
                    Smoking History
                    {field.value && (
                      <span className="ml-2 text-sm text-primary">Pack years required</span>
                    )}
                  </FormLabel>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="past_respiratory_diseases"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Past Respiratory Diseases</FormLabel>
                  <FormControl>
                    <div className="flex flex-wrap gap-2">
                      {PAST_DISEASES.map((disease) => (
                        <label
                          key={disease}
                          className={cn(
                            "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition-colors cursor-pointer",
                            field.value.includes(disease)
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-muted-foreground/25 hover:border-primary/50"
                          )}
                        >
                          <Checkbox
                            type="checkbox"
                            checked={field.value.includes(disease)}
                            onChange={(e) => {
                              const newValue = e.target.checked
                                ? [...field.value, disease]
                                : field.value.filter((d: string) => d !== disease)
                              field.onChange(newValue)
                            }}
                            className="h-3.5 w-3.5"
                          />
                          {disease}
                        </label>
                      ))}
                    </div>
                  </FormControl>
                  <FormDescription>Select all that apply</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="symptoms"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Current Symptoms</FormLabel>
                  <FormControl>
                    <div className="flex flex-wrap gap-2">
                      {SYMPTOMS.map((symptom) => (
                        <label
                          key={symptom}
                          className={cn(
                            "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition-colors cursor-pointer",
                            field.value.includes(symptom)
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-muted-foreground/25 hover:border-primary/50"
                          )}
                        >
                          <Checkbox
                            type="checkbox"
                            checked={field.value.includes(symptom)}
                            onChange={(e) => {
                              const newValue = e.target.checked
                                ? [...field.value, symptom]
                                : field.value.filter((s: string) => s !== symptom)
                              field.onChange(newValue)
                            }}
                            className="h-3.5 w-3.5"
                          />
                          {symptom}
                        </label>
                      ))}
                    </div>
                  </FormControl>
                  <FormDescription>Select all current symptoms</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "Creating..." : "Create Patient & Continue"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}