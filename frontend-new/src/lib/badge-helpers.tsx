import { Badge } from "@/components/ui/badge"
import { AlertTriangle, CheckCircle } from "lucide-react"

export function getTbBadge(label: string) {
  return (
    <Badge variant={label === "TB" ? "destructive" : "success"} className="gap-1">
      {label === "TB" && <AlertTriangle className="h-3 w-3" />}
      {label === "Non-TB" && <CheckCircle className="h-3 w-3" />}
      {label}
    </Badge>
  )
}

export function getRespBadge(label: string | null) {
  if (!label) return <Badge variant="secondary">N/A</Badge>
  const variants: Record<string, "default" | "success" | "warning" | "destructive"> = {
    Healthy: "success",
    Pneumonia: "destructive",
    COPD: "warning",
  }
  return <Badge variant={variants[label] || "default"}>{label}</Badge>
}

export function getStatusBadge(status: string) {
  const variants: Record<string, "default" | "success" | "warning" | "destructive" | "secondary"> = {
    pending: "warning",
    completed: "success",
    failed: "destructive",
  }
  return <Badge variant={variants[status] || "secondary"}>{status}</Badge>
}

export function getConfidenceColor(conf: number | null): string {
  if (conf === null) return "text-muted-foreground"
  if (conf >= 0.9) return "text-green-600 dark:text-green-400"
  if (conf >= 0.7) return "text-yellow-600 dark:text-yellow-400"
  return "text-red-600 dark:text-red-400"
}
