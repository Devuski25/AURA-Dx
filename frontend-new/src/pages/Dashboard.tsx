"use client"

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import { Loader2, FileText, AlertTriangle, CheckCircle, XCircle, Stethoscope } from "lucide-react"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"

interface Stats {
  total: number
  tb_positive: number
  tb_negative: number
  healthy: number
  pneumonia: number
  copd: number
}

export function Dashboard() {
  const { user, loading: authLoading } = useAuth()
  const [stats, setStats] = useState<Stats>({
    total: 0,
    tb_positive: 0,
    tb_negative: 0,
    healthy: 0,
    pneumonia: 0,
    copd: 0,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchScreenings()
  }, [user])

  const fetchScreenings = async () => {
    if (!user) return
    setLoading(true)
    try {
      let query = supabase
        .from("screening_history_view")
        .select("*")

      if (user.role === "admin" && user.clinic_id) {
        query = query.eq("clinic_id", user.clinic_id)
      }

      const { data, error } = await query.order("created_at", { ascending: false })
      if (error) throw error

      const screeningsData = data || []
      setStats({
        total: screeningsData.length,
        tb_positive: screeningsData.filter(s => s.tb_result === "TB").length,
        tb_negative: screeningsData.filter(s => s.tb_result === "Non-TB").length,
        healthy: screeningsData.filter(s => s.respiratory_result === "Healthy").length,
        pneumonia: screeningsData.filter(s => s.respiratory_result === "Pneumonia").length,
        copd: screeningsData.filter(s => s.respiratory_result === "COPD").length,
      })
    } catch (error) {
      console.error("Error fetching screenings:", error)
    } finally {
      setLoading(false)
    }
  }

  if (authLoading || loading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  const cards = [
    {
      title: "Total Screenings",
      value: stats.total,
      icon: FileText,
      bg: "bg-gradient-to-br from-blue-500 to-blue-700",
    },
    {
      title: "TB Positive",
      value: stats.tb_positive,
      icon: AlertTriangle,
      bg: "bg-gradient-to-br from-red-500 to-red-700",
    },
    {
      title: "COPD Positive",
      value: stats.copd,
      icon: Stethoscope,
      bg: "bg-gradient-to-br from-orange-500 to-orange-700",
    },
    {
      title: "Pneumonia Positive",
      value: stats.pneumonia,
      icon: XCircle,
      bg: "bg-gradient-to-br from-purple-500 to-purple-700",
    },
    {
      title: "Healthy",
      value: stats.healthy,
      icon: CheckCircle,
      bg: "bg-gradient-to-br from-green-500 to-green-700",
    },
  ]

  return (
    <div className="space-y-4">
      <div className="grid gap-4">
        <Card className={cn("border-0 text-white", cards[0].bg)}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg font-semibold">{cards[0].title}</CardTitle>
              <FileText className="h-8 w-8 opacity-80" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">{cards[0].value}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Card className={cn("border-0 text-white", cards[1].bg)}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">{cards[1].title}</CardTitle>
              <AlertTriangle className="h-5 w-5 opacity-80" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{cards[1].value}</div>
          </CardContent>
        </Card>
        <Card className={cn("border-0 text-white", cards[2].bg)}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">{cards[2].title}</CardTitle>
              <Stethoscope className="h-5 w-5 opacity-80" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{cards[2].value}</div>
          </CardContent>
        </Card>
        <Card className={cn("border-0 text-white", cards[3].bg)}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">{cards[3].title}</CardTitle>
              <XCircle className="h-5 w-5 opacity-80" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{cards[3].value}</div>
          </CardContent>
        </Card>
        <Card className={cn("border-0 text-white", cards[4].bg)}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">{cards[4].title}</CardTitle>
              <CheckCircle className="h-5 w-5 opacity-80" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{cards[4].value}</div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}