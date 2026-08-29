import { Badge } from "@/components/ui/badge"
import { AlertTriangle, CheckCircle } from "lucide-react"

export function getTbBadge(label: string) {
  if (label === "TB") {
    return (
      <Badge className="gap-1.5 border-aura-coral/30 bg-aura-coral-soft px-3 py-1 text-aura-coral-strong hover:bg-aura-coral-soft">
        <AlertTriangle className="h-3.5 w-3.5" />
        {label}
      </Badge>
    )
  }
  return (
    <Badge className="gap-1.5 border-aura-mint/30 bg-aura-mint-soft px-3 py-1 text-aura-pine hover:bg-aura-mint-soft">
      <CheckCircle className="h-3.5 w-3.5" />
      {label}
    </Badge>
  )
}

export function getRespBadge(label: string | null) {
  if (!label) return <Badge variant="secondary" className="px-3 py-1">N/A</Badge>
  const styles: Record<string, string> = {
    Healthy: "border-aura-mint/30 bg-aura-mint-soft text-aura-pine hover:bg-aura-mint-soft",
    Pneumonia: "border-aura-coral/30 bg-aura-coral-soft text-aura-coral-strong hover:bg-aura-coral-soft",
    COPD: "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100",
  }
  return (
    <Badge className={`gap-1.5 px-3 py-1 ${styles[label] || ""}`}>
      {label === "Healthy" && <CheckCircle className="h-3.5 w-3.5" />}
      {label === "Pneumonia" && <AlertTriangle className="h-3.5 w-3.5" />}
      {label}
    </Badge>
  )
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
  if (conf >= 0.9) return "text-aura-forest"
  if (conf >= 0.7) return "text-aura-warning"
  return "text-destructive"
}