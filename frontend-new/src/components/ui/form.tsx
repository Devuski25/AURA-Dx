"use client"

import * as React from "react"
import { useFormContext, type UseFormReturn, type FieldValues } from "react-hook-form"
import { Controller } from "react-hook-form"
import { cn } from "@/lib/utils"

export function Form<TFieldValues extends FieldValues = FieldValues>({
  ...props
}: React.ComponentPropsWithoutRef<"form"> & {
  form?: UseFormReturn<TFieldValues>
}) {
  return <form {...props} />
}

export function FormField({
  control: controlProp,
  name,
  render,
}: {
  control?: any
  name: string
  render: (props: any) => React.ReactElement
}) {
  const formContext = useFormContext<any>()
  const control = controlProp || formContext?.control

  if (!control) {
    throw new Error("FormField must be used within a Form component or have a control prop")
  }

  return <Controller control={control} name={name as any} render={render} />
}

export function FormItem({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("space-y-2", className)} {...props} />
}

export function FormLabel({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70", className)} {...props} />
}

export function FormControl({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("", className)} {...props} />
}

export function FormDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />
}

export function FormMessage({ className, children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-destructive", className)} {...props}>{children}</p>
}