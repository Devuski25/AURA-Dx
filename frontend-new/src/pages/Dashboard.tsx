"use client"

import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { staggerContainer, staggerItem, cardHover } from "@/lib/motion"
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
      accentBorder: "border-l-cough-accent",
      accentText: "text-cough-accent",
    },
    {
      title: "TB Positive",
      value: stats.tb_positive,
      icon: AlertTriangle,
      accentBorder: "border-l-red-500",
      accentText: "text-red-600",
    },
    {
      title: "COPD Positive",
      value: stats.copd,
      icon: Stethoscope,
      accentBorder: "border-l-orange-500",
      accentText: "text-orange-600",
    },
    {
      title: "Pneumonia Positive",
      value: stats.pneumonia,
      icon: XCircle,
      accentBorder: "border-l-purple-500",
      accentText: "text-purple-600",
    },
    {
      title: "Healthy",
      value: stats.healthy,
      icon: CheckCircle,
      accentBorder: "border-l-green-500",
      accentText: "text-green-600",
    },
  ]

  return (
    <div className="space-y-4">
      <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="grid gap-4">
        <motion.div variants={staggerItem} whileHover={cardHover.whileHover} whileTap={cardHover.whileTap}>
          <Card className="border border-cough-border-soft bg-cough-bg-card shadow-cough-sm border-l-4 border-l-cough-accent">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg font-semibold text-cough-text">{cards[0].title}</CardTitle>
              <FileText className="h-8 w-8 text-cough-accent" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-cough-text">{cards[0].value}</div>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>

      <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {cards.slice(1).map((card) => {
          const Icon = card.icon
          return (
            <motion.div key={card.title} variants={staggerItem} whileHover={cardHover.whileHover} whileTap={cardHover.whileTap}>
              <Card className={cn("border border-cough-border-soft bg-cough-bg-card shadow-cough-sm border-l-4", card.accentBorder)}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className={cn("text-sm font-medium", card.accentText)}>{card.title}</CardTitle>
                  <Icon className={cn("h-5 w-5", card.accentText)} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-cough-text">{card.value}</div>
              </CardContent>
            </Card>
          </motion.div>
        )
        })}
      </motion.div>
    </div>
  )
}