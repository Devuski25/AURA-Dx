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

export function getResultBadge(tbResult: string | null, respResult: string | null) {
  if (tbResult === "TB") {
    return <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" />TB</Badge>
  }
  if (respResult) {
    const variants: Record<string, "default" | "success" | "warning" | "destructive"> = {
      Healthy: "success",
      Pneumonia: "destructive",
      COPD: "warning",
    }
    return <Badge variant={variants[respResult] || "default"}>{respResult}</Badge>
  }
  return <Badge variant="secondary">N/A</Badge>
}

export function getConfidenceColor(conf: number | null): string {
  if (conf === null) return "text-muted-foreground"
  if (conf >= 0.9) return "text-green-600"
  if (conf >= 0.7) return "text-yellow-600"
  return "text-red-600"
}
