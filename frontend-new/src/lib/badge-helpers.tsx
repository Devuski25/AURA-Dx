import { Badge } from "@/components/ui/badge"
import { AlertTriangle, CheckCircle } from "lucide-react"

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

/**
 * Single canonical result rendering for ALL list views.
 * Returns only the respiratory classification badge.
 */
export function renderResultBadges(respResult: string | null) {
  if (!respResult) return null

  const variants: Record<string, "default" | "success" | "warning" | "destructive"> = {
    Healthy: "success",
    Pneumonia: "destructive",
    COPD: "warning",
  }
  return (
    <Badge variant={variants[respResult] || "default"}>{respResult}</Badge>
  )
}

/**
 * Item 13: inline confidence chip for list views. The Screening Result page
 * shows full percentages; lists get the same number compactly so a 51% vs
 * 98% classification is visible without opening each record.
 */
export function ConfidenceChip({ value, className = "" }: { value: number | null; className?: string }) {
  if (value == null) return null
  return (
    <span className={`text-[11px] font-medium tabular-nums ${getConfidenceColor(value)} ${className}`}>
      {Math.round(value * 100)}% conf.
    </span>
  )
}

export function getConfidenceColor(conf: number | null): string {
  if (conf === null) return "text-muted-foreground"
  // Item 13 semantics: confidence >= 0.7 is clinically usable, 0.5-0.7 is a
  // caution zone, < 0.5 means the classifier is barely above chance.
  if (conf >= 0.7) return "text-aura-forest"
  if (conf >= 0.5) return "text-aura-warning"
  return "text-destructive"
}