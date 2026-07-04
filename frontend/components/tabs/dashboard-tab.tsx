"use client"

import { useState, useMemo, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts"
import { format } from "date-fns"
import { ja } from "date-fns/locale/ja"
import { CalendarIcon } from "lucide-react"

import { Tab } from "@shared/types"

interface DashboardTabProps {
  onTabChange?: (tab: Tab) => void
}

export function DashboardTab({ onTabChange }: DashboardTabProps) {
  const [displayMonth, setDisplayMonth] = useState("10")
  const [displayMonths, setDisplayMonths] = useState("4")
  const [yearAccumulation, setYearAccumulation] = useState("none")
  // グラフ用の対象月と表示月数
  const [chartStartMonth, setChartStartMonth] = useState("10")
  const [chartDisplayMonths, setChartDisplayMonths] = useState("1")
  // 表示月数選択の表示/非表示設定
  const [showDisplayMonthsSelector, setShowDisplayMonthsSelector] = useState(false)
  // 伸び率の高いサイトの表示/非表示設定
  const [showTopSitesSection, setShowTopSitesSection] = useState(false)

  // 日付比較設定
  const [comparisonType, setComparisonType] = useState<"previousDay" | "weekAgo" | "lastMonth" | "custom">("previousDay")
  const [customComparisonDate, setCustomComparisonDate] = useState<Date | undefined>(undefined)

  // 比較対象日付を計算
  const comparisonDate = useMemo(() => {
    const today = new Date(2025, 9, 19) // 10月19日を想定
    switch (comparisonType) {
      case "previousDay": {
        const prevDay = new Date(today)
        prevDay.setDate(prevDay.getDate() - 1)
        return prevDay
      }
      case "weekAgo": {
        const weekAgo = new Date(today)
        weekAgo.setDate(weekAgo.getDate() - 7)
        return weekAgo
      }
      case "lastMonth": {
        const lastMonth = new Date(today)
        lastMonth.setMonth(lastMonth.getMonth() - 1)
        return lastMonth
      }
      case "custom":
        return customComparisonDate || (() => {
          const prevDay = new Date(today)
          prevDay.setDate(prevDay.getDate() - 1)
          return prevDay
        })()
      default: {
        const prevDay = new Date(today)
        prevDay.setDate(prevDay.getDate() - 1)
        return prevDay
      }
    }
  }, [comparisonType, customComparisonDate])

  // localStorageから設定を読み込む
  useEffect(() => {
    const loadSettings = () => {
      if (typeof window !== "undefined") {
        const savedDisplayMonths = localStorage.getItem("dashboard.showDisplayMonthsSelector")
        const isDisplayMonthsEnabled = savedDisplayMonths === "true"
        setShowDisplayMonthsSelector(isDisplayMonthsEnabled)
        // 設定が非表示の場合は常に1ヶ月に固定
        if (!isDisplayMonthsEnabled) {
          setChartDisplayMonths("1")
        }

        const savedTopSites = localStorage.getItem("dashboard.showTopSitesSection")
        const isTopSitesEnabled = savedTopSites === "true"
        setShowTopSitesSection(isTopSitesEnabled)
      }
    }

    loadSettings()

    // localStorageの変更を監視（設定画面で変更された場合に反映）
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "dashboard.showDisplayMonthsSelector" || e.key === "dashboard.showTopSitesSection") {
        loadSettings()
      }
    }

    window.addEventListener("storage", handleStorageChange)
    // 同じウィンドウ内での変更も監視するため、カスタムイベントも監視
    window.addEventListener("settingsUpdated", loadSettings)

    return () => {
      window.removeEventListener("storage", handleStorageChange)
      window.removeEventListener("settingsUpdated", loadSettings)
    }
  }, [])

  // 各月ごとのデータを生成
  const monthlyKpiData = useMemo(() => {
    const startMonthNum = Number.parseInt(displayMonth)
    const monthsCount = Number.parseInt(displayMonths)

    // 画像に基づいた各月のデータ（10月、11月、12月、1月の例）
    // 各KPI指標ごとに異なる予算比・前年比を設定
    const monthDataTemplates: Record<number, any> = {
      10: {
        // 10月のデータ
        roomRevenue: {
          onHand: 491588814,
          aiPrediction: 565136000,
          budgetRatio: { today: 0.953, cumulative: 0.87 },
          lastYearRatio: { today: 0.953, cumulative: 0.899 },
          aiBudgetRatio: 1.016,
          aiLastYearRatio: 1.034,
          annualBudgetRatio: 0.88,
          annualLastYearRatio: 0.92,
        },
        roomsSold: {
          onHand: 30276,
          aiPrediction: 33800,
          budgetRatio: { today: 0.98, cumulative: 0.806 },
          lastYearRatio: { today: 0.98, cumulative: 0.93 },
          aiBudgetRatio: 1.02,
          aiLastYearRatio: 1.038,
          annualBudgetRatio: 0.85,
          annualLastYearRatio: 0.94,
        },
        adr: {
          onHand: 16237,
          aiPrediction: 16720,
          budgetRatio: { today: 0.972, cumulative: 0.971 },
          lastYearRatio: { today: 0.972, cumulative: 0.985 },
          aiBudgetRatio: 0.996,
          aiLastYearRatio: 1.014,
          annualBudgetRatio: 0.98,
          annualLastYearRatio: 0.99,
        },
        occupancy: {
          onHand: 0.783,
          aiPrediction: 0.852,
          budgetRatio: { today: 0.98, cumulative: 0.896 },
          lastYearRatio: { today: 0.98, cumulative: 0.93 },
          aiBudgetRatio: 1.02,
          aiLastYearRatio: 1.038,
          annualBudgetRatio: 0.91,
          annualLastYearRatio: 0.95,
        },
        revpar: {
          onHand: 12389,
          aiPrediction: 14242,
          budgetRatio: { today: 0.953, cumulative: 0.87 },
          lastYearRatio: { today: 0.953, cumulative: 0.899 },
          aiBudgetRatio: 1.016,
          aiLastYearRatio: 1.034,
          annualBudgetRatio: 0.89,
          annualLastYearRatio: 0.91,
        },
        guests: {
          onHand: 52074,
          aiPrediction: 61178,
          budgetRatio: { today: 0.986, cumulative: 0.851 },
          lastYearRatio: { today: 0.986, cumulative: 0.888 },
          aiBudgetRatio: 1.026,
          aiLastYearRatio: 1.044,
          annualBudgetRatio: 0.86,
          annualLastYearRatio: 0.90,
        },
        dor: {
          onHand: 1.72,
          aiPrediction: 1.81,
          budgetRatio: { today: 1.006, cumulative: 0.95 },
          lastYearRatio: { today: 1.006, cumulative: 0.973 },
          aiBudgetRatio: 1.006,
          aiLastYearRatio: 1.024,
          annualBudgetRatio: 0.96,
          annualLastYearRatio: 0.98,
        },
        guestSpend: {
          onHand: 9440,
          aiPrediction: 9238,
          budgetRatio: { today: 0.956, cumulative: 1.022 },
          lastYearRatio: { today: 0.966, cumulative: 1.03 },
          aiBudgetRatio: 0.99,
          aiLastYearRatio: 1.008,
          annualBudgetRatio: 1.01,
          annualLastYearRatio: 1.02,
        },
      },
      11: {
        roomRevenue: {
          onHand: 306409881,
          aiPrediction: 587285600,
          budgetRatio: { today: 0.953, cumulative: 0.54 },
          lastYearRatio: { today: 0.953, cumulative: 0.55 },
          aiBudgetRatio: 1.035,
          aiLastYearRatio: 1.053,
        },
        roomsSold: {
          onHand: 19452,
          aiPrediction: 34814,
          budgetRatio: { today: 0.98, cumulative: 0.57 },
          lastYearRatio: { today: 0.98, cumulative: 0.58 },
          aiBudgetRatio: 1.02,
          aiLastYearRatio: 1.038,
        },
        adr: {
          onHand: 15752,
          aiPrediction: 16869,
          budgetRatio: { today: 0.972, cumulative: 0.947 },
          lastYearRatio: { today: 0.972, cumulative: 0.947 },
          aiBudgetRatio: 1.015,
          aiLastYearRatio: 1.015,
        },
        occupancy: {
          onHand: 0.507,
          aiPrediction: 0.907,
          budgetRatio: { today: 0.98, cumulative: 0.57 },
          lastYearRatio: { today: 0.98, cumulative: 0.58 },
          aiBudgetRatio: 1.02,
          aiLastYearRatio: 1.038,
        },
        revpar: {
          onHand: 7979,
          aiPrediction: 15204,
          budgetRatio: { today: 0.953, cumulative: 0.54 },
          lastYearRatio: { today: 0.953, cumulative: 0.55 },
          aiBudgetRatio: 1.035,
          aiLastYearRatio: 1.053,
        },
        guests: {
          onHand: 34236,
          aiPrediction: 63643,
          budgetRatio: { today: 0.986, cumulative: 0.552 },
          lastYearRatio: { today: 0.986, cumulative: 0.572 },
          aiBudgetRatio: 1.026,
          aiLastYearRatio: 1.083,
        },
        dor: {
          onHand: 1.76,
          aiPrediction: 1.83,
          budgetRatio: { today: 1.006, cumulative: 0.968 },
          lastYearRatio: { today: 1.006, cumulative: 0.985 },
          aiBudgetRatio: 1.006,
          aiLastYearRatio: 1.024,
        },
        guestSpend: {
          onHand: 8950,
          aiPrediction: 9228,
          budgetRatio: { today: 0.956, cumulative: 0.979 },
          lastYearRatio: { today: 0.966, cumulative: 0.961 },
          aiBudgetRatio: 1.009,
          aiLastYearRatio: 0.901,
        },
      },
      12: {
        roomRevenue: {
          onHand: 179128507,
          aiPrediction: 514354710,
          budgetRatio: { today: 0.953, cumulative: 0.35 },
          lastYearRatio: { today: 0.953, cumulative: 0.356 },
          aiBudgetRatio: 1.005,
          aiLastYearRatio: 1.023,
        },
        roomsSold: {
          onHand: 11860,
          aiPrediction: 32721,
          budgetRatio: { today: 0.98, cumulative: 0.37 },
          lastYearRatio: { today: 0.98, cumulative: 0.377 },
          aiBudgetRatio: 1.02,
          aiLastYearRatio: 1.038,
        },
        adr: {
          onHand: 15092,
          aiPrediction: 15720,
          budgetRatio: { today: 0.972, cumulative: 0.946 },
          lastYearRatio: { today: 0.972, cumulative: 0.946 },
          aiBudgetRatio: 0.985,
          aiLastYearRatio: 0.985,
        },
        occupancy: {
          onHand: 0.299,
          aiPrediction: 0.825,
          budgetRatio: { today: 0.98, cumulative: 0.37 },
          lastYearRatio: { today: 0.98, cumulative: 0.377 },
          aiBudgetRatio: 1.02,
          aiLastYearRatio: 1.038,
        },
        revpar: {
          onHand: 4514,
          aiPrediction: 12963,
          budgetRatio: { today: 0.953, cumulative: 0.35 },
          lastYearRatio: { today: 0.953, cumulative: 0.356 },
          aiBudgetRatio: 1.005,
          aiLastYearRatio: 1.023,
        },
        guests: {
          onHand: 21246,
          aiPrediction: 58844,
          budgetRatio: { today: 0.986, cumulative: 0.357 },
          lastYearRatio: { today: 0.986, cumulative: 0.37 },
          aiBudgetRatio: 0.989,
          aiLastYearRatio: 1.025,
        },
        dor: {
          onHand: 1.79,
          aiPrediction: 1.80,
          budgetRatio: { today: 1.006, cumulative: 0.965 },
          lastYearRatio: { today: 1.006, cumulative: 0.983 },
          aiBudgetRatio: 0.97,
          aiLastYearRatio: 0.987,
        },
        guestSpend: {
          onHand: 8431,
          aiPrediction: 8741,
          budgetRatio: { today: 0.956, cumulative: 0.98 },
          lastYearRatio: { today: 0.966, cumulative: 0.963 },
          aiBudgetRatio: 1.016,
          aiLastYearRatio: 0.998,
        },
      },
      1: {
        roomRevenue: {
          onHand: 56853831,
          aiPrediction: 383915820,
          budgetRatio: { today: 0.953, cumulative: 0.14 },
          lastYearRatio: { today: 0.953, cumulative: 0.142 },
          aiBudgetRatio: 0.97,
          aiLastYearRatio: 0.987,
        },
        roomsSold: {
          onHand: 4145,
          aiPrediction: 24868,
          budgetRatio: { today: 0.98, cumulative: 0.17 },
          lastYearRatio: { today: 0.98, cumulative: 0.173 },
          aiBudgetRatio: 1.02,
          aiLastYearRatio: 1.038,
        },
        adr: {
          onHand: 13717,
          aiPrediction: 15840,
          budgetRatio: { today: 0.972, cumulative: 0.824 },
          lastYearRatio: { today: 0.972, cumulative: 0.824 },
          aiBudgetRatio: 0.951,
          aiLastYearRatio: 0.951,
        },
        occupancy: {
          onHand: 0.104,
          aiPrediction: 0.627,
          budgetRatio: { today: 0.98, cumulative: 0.17 },
          lastYearRatio: { today: 0.98, cumulative: 0.173 },
          aiBudgetRatio: 1.02,
          aiLastYearRatio: 1.038,
        },
        revpar: {
          onHand: 1433,
          aiPrediction: 9927,
          budgetRatio: { today: 0.953, cumulative: 0.14 },
          lastYearRatio: { today: 0.953, cumulative: 0.142 },
          aiBudgetRatio: 0.97,
          aiLastYearRatio: 0.987,
        },
        guests: {
          onHand: 7377,
          aiPrediction: 42551,
          budgetRatio: { today: 0.986, cumulative: 0.172 },
          lastYearRatio: { today: 0.986, cumulative: 0.178 },
          aiBudgetRatio: 0.989,
          aiLastYearRatio: 1.025,
        },
        dor: {
          onHand: 1.78,
          aiPrediction: 1.71,
          budgetRatio: { today: 1.0, cumulative: 1.0 },
          lastYearRatio: { today: 1.0, cumulative: 1.027 },
          aiBudgetRatio: 0.97,
          aiLastYearRatio: 0.987,
        },
        guestSpend: {
          onHand: 7706,
          aiPrediction: 9258,
          budgetRatio: { today: 0.966, cumulative: 0.816 },
          lastYearRatio: { today: 0.956, cumulative: 0.802 },
          aiBudgetRatio: 0.98,
          aiLastYearRatio: 0.963,
        },
      },
    }

    // 各月のデータを生成
    return Array.from({ length: monthsCount }, (_, i) => {
      const monthNum = startMonthNum + i
      const actualMonth = monthNum > 12 ? monthNum - 12 : monthNum
      const template = monthDataTemplates[actualMonth] || monthDataTemplates[10] // デフォルトは10月のデータ

      const kpiRows = [
        {
          label: "室料売上",
          onHand: `¥${template.roomRevenue.onHand.toLocaleString()}`,
          budgetProgress: `${(template.roomRevenue.budgetRatio.today * 100).toFixed(1)}%`,
          budgetComparison: `${(template.roomRevenue.budgetRatio.cumulative * 100).toFixed(1)}%`,
          lastYearProgress: `${(template.roomRevenue.lastYearRatio.today * 100).toFixed(1)}%`,
          lastYearComparison: `${(template.roomRevenue.lastYearRatio.cumulative * 100).toFixed(1)}%`,
          aiPrediction: `¥${template.roomRevenue.aiPrediction.toLocaleString()}`,
          aiBudgetRatio: `${(template.roomRevenue.aiBudgetRatio * 100).toFixed(1)}%`,
          aiLastYearRatio: `${(template.roomRevenue.aiLastYearRatio * 100).toFixed(1)}%`,
          budgetComparisonNegative: template.roomRevenue.budgetRatio.cumulative < 0.95,
          lastYearComparisonNegative: template.roomRevenue.lastYearRatio.cumulative < 0.95,
          annualBudgetRatio: `${(template.roomRevenue.annualBudgetRatio * 100).toFixed(1)}%`,
          annualLastYearRatio: `${(template.roomRevenue.annualLastYearRatio * 100).toFixed(1)}%`,
        },
        {
          label: "販売室数",
          onHand: `${template.roomsSold.onHand.toLocaleString()}室`,
          budgetProgress: `${(template.roomsSold.budgetRatio.today * 100).toFixed(1)}%`,
          budgetComparison: `${(template.roomsSold.budgetRatio.cumulative * 100).toFixed(1)}%`,
          lastYearProgress: `${(template.roomsSold.lastYearRatio.today * 100).toFixed(1)}%`,
          lastYearComparison: `${(template.roomsSold.lastYearRatio.cumulative * 100).toFixed(1)}%`,
          aiPrediction: `${template.roomsSold.aiPrediction.toLocaleString()}室`,
          aiBudgetRatio: `${(template.roomsSold.aiBudgetRatio * 100).toFixed(1)}%`,
          aiLastYearRatio: `${(template.roomsSold.aiLastYearRatio * 100).toFixed(1)}%`,
          budgetComparisonNegative: template.roomsSold.budgetRatio.cumulative < 0.95,
          lastYearComparisonNegative: template.roomsSold.lastYearRatio.cumulative < 0.95,
          annualBudgetRatio: `${(template.roomsSold.annualBudgetRatio * 100).toFixed(1)}%`,
          annualLastYearRatio: `${(template.roomsSold.annualLastYearRatio * 100).toFixed(1)}%`,
        },
        {
          label: "ADR",
          onHand: `¥${template.adr.onHand.toLocaleString()}`,
          budgetProgress: `${(template.adr.budgetRatio.today * 100).toFixed(1)}%`,
          budgetComparison: `${(template.adr.budgetRatio.cumulative * 100).toFixed(1)}%`,
          lastYearProgress: `${(template.adr.lastYearRatio.today * 100).toFixed(1)}%`,
          lastYearComparison: `${(template.adr.lastYearRatio.cumulative * 100).toFixed(1)}%`,
          aiPrediction: `¥${template.adr.aiPrediction.toLocaleString()}`,
          aiBudgetRatio: `${(template.adr.aiBudgetRatio * 100).toFixed(1)}%`,
          aiLastYearRatio: `${(template.adr.aiLastYearRatio * 100).toFixed(1)}%`,
          budgetComparisonNegative: template.adr.budgetRatio.cumulative < 0.95,
          lastYearComparisonNegative: template.adr.lastYearRatio.cumulative < 0.95,
          annualBudgetRatio: `${(template.adr.annualBudgetRatio * 100).toFixed(1)}%`,
          annualLastYearRatio: `${(template.adr.annualLastYearRatio * 100).toFixed(1)}%`,
        },
        {
          label: "稼働率",
          onHand: `${(template.occupancy.onHand * 100).toFixed(1)}%`,
          budgetProgress: `${(template.occupancy.budgetRatio.today * 100).toFixed(1)}%`,
          budgetComparison: `${(template.occupancy.budgetRatio.cumulative * 100).toFixed(1)}%`,
          lastYearProgress: `${(template.occupancy.lastYearRatio.today * 100).toFixed(1)}%`,
          lastYearComparison: `${(template.occupancy.lastYearRatio.cumulative * 100).toFixed(1)}%`,
          aiPrediction: `${(template.occupancy.aiPrediction * 100).toFixed(1)}%`,
          aiBudgetRatio: `${(template.occupancy.aiBudgetRatio * 100).toFixed(1)}%`,
          aiLastYearRatio: `${(template.occupancy.aiLastYearRatio * 100).toFixed(1)}%`,
          budgetComparisonNegative: template.occupancy.budgetRatio.cumulative < 0.95,
          lastYearComparisonNegative: template.occupancy.lastYearRatio.cumulative < 0.95,
          annualBudgetRatio: `${(template.occupancy.annualBudgetRatio * 100).toFixed(1)}%`,
          annualLastYearRatio: `${(template.occupancy.annualLastYearRatio * 100).toFixed(1)}%`,
        },
        {
          label: "REV-Per",
          onHand: `¥${template.revpar.onHand.toLocaleString()}`,
          budgetProgress: `${(template.revpar.budgetRatio.today * 100).toFixed(1)}%`,
          budgetComparison: `${(template.revpar.budgetRatio.cumulative * 100).toFixed(1)}%`,
          lastYearProgress: `${(template.revpar.lastYearRatio.today * 100).toFixed(1)}%`,
          lastYearComparison: `${(template.revpar.lastYearRatio.cumulative * 100).toFixed(1)}%`,
          aiPrediction: `¥${template.revpar.aiPrediction.toLocaleString()}`,
          aiBudgetRatio: `${(template.revpar.aiBudgetRatio * 100).toFixed(1)}%`,
          aiLastYearRatio: `${(template.revpar.aiLastYearRatio * 100).toFixed(1)}%`,
          budgetComparisonNegative: template.revpar.budgetRatio.cumulative < 0.95,
          lastYearComparisonNegative: template.revpar.lastYearRatio.cumulative < 0.95,
          annualBudgetRatio: `${(template.revpar.annualBudgetRatio * 100).toFixed(1)}%`,
          annualLastYearRatio: `${(template.revpar.annualLastYearRatio * 100).toFixed(1)}%`,
        },
        {
          label: "宿泊人数",
          onHand: `${template.guests.onHand.toLocaleString()}人`,
          budgetProgress: `${(template.guests.budgetRatio.today * 100).toFixed(1)}%`,
          budgetComparison: `${(template.guests.budgetRatio.cumulative * 100).toFixed(1)}%`,
          lastYearProgress: `${(template.guests.lastYearRatio.today * 100).toFixed(1)}%`,
          lastYearComparison: `${(template.guests.lastYearRatio.cumulative * 100).toFixed(1)}%`,
          aiPrediction: `${template.guests.aiPrediction.toLocaleString()}人`,
          aiBudgetRatio: `${(template.guests.aiBudgetRatio * 100).toFixed(1)}%`,
          aiLastYearRatio: `${(template.guests.aiLastYearRatio * 100).toFixed(1)}%`,
          budgetComparisonNegative: template.guests.budgetRatio.cumulative < 0.95,
          lastYearComparisonNegative: template.guests.lastYearRatio.cumulative < 0.95,
          annualBudgetRatio: `${(template.guests.annualBudgetRatio * 100).toFixed(1)}%`,
          annualLastYearRatio: `${(template.guests.annualLastYearRatio * 100).toFixed(1)}%`,
        },
        {
          label: "DOR",
          onHand: `${template.dor.onHand.toFixed(2)}人`,
          budgetProgress: `${(template.dor.budgetRatio.today * 100).toFixed(1)}%`,
          budgetComparison: `${(template.dor.budgetRatio.cumulative * 100).toFixed(1)}%`,
          lastYearProgress: `${(template.dor.lastYearRatio.today * 100).toFixed(1)}%`,
          lastYearComparison: `${(template.dor.lastYearRatio.cumulative * 100).toFixed(1)}%`,
          aiPrediction: `${template.dor.aiPrediction.toFixed(2)}人`,
          aiBudgetRatio: `${(template.dor.aiBudgetRatio * 100).toFixed(1)}%`,
          aiLastYearRatio: `${(template.dor.aiLastYearRatio * 100).toFixed(1)}%`,
          budgetComparisonNegative: template.dor.budgetRatio.cumulative < 0.95,
          lastYearComparisonNegative: template.dor.lastYearRatio.cumulative < 0.95,
          annualBudgetRatio: `${(template.dor.annualBudgetRatio * 100).toFixed(1)}%`,
          annualLastYearRatio: `${(template.dor.annualLastYearRatio * 100).toFixed(1)}%`,
        },
        {
          label: "客単価",
          onHand: `¥${template.guestSpend.onHand.toLocaleString()}`,
          budgetProgress: `${(template.guestSpend.budgetRatio.today * 100).toFixed(1)}%`,
          budgetComparison: `${(template.guestSpend.budgetRatio.cumulative * 100).toFixed(1)}%`,
          lastYearProgress: `${(template.guestSpend.lastYearRatio.today * 100).toFixed(1)}%`,
          lastYearComparison: `${(template.guestSpend.lastYearRatio.cumulative * 100).toFixed(1)}%`,
          aiPrediction: `¥${template.guestSpend.aiPrediction.toLocaleString()}`,
          aiBudgetRatio: `${(template.guestSpend.aiBudgetRatio * 100).toFixed(1)}%`,
          aiLastYearRatio: `${(template.guestSpend.aiLastYearRatio * 100).toFixed(1)}%`,
          budgetComparisonNegative: template.guestSpend.budgetRatio.cumulative < 0.95,
          lastYearComparisonNegative: template.guestSpend.lastYearRatio.cumulative < 0.95,
          annualBudgetRatio: `${(template.guestSpend.annualBudgetRatio * 100).toFixed(1)}%`,
          annualLastYearRatio: `${(template.guestSpend.annualLastYearRatio * 100).toFixed(1)}%`,
        },
      ]

      return {
        month: actualMonth,
        monthLabel: `${actualMonth}月`,
        kpiRows,
      }
    })
  }, [displayMonth, displayMonths])

  const adrChartData = useMemo(() => {
    const startMonthNum = Number.parseInt(chartStartMonth)
    const displayMonthsNum = Number.parseInt(chartDisplayMonths)

    // 対象月の1日を基準日とする
    const baseDate = new Date(2025, startMonthNum - 1, 1)

    // 今日の日付（2025年10月19日を想定）
    const today = new Date(2025, 9, 19) // 10月 = 9 (0-indexed)
    const todayDateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate())

    // 表示する月の最終日を計算
    const endDate = new Date(2025, startMonthNum - 1 + displayMonthsNum, 0) // 次の月の0日 = 最終月の最終日
    const daysInMonth = displayMonthsNum === 1 ? endDate.getDate() : null // 1ヶ月の場合のみ使用

    // 実績データの最後の値を保持するための変数
    let lastOccupancyActual: number | null = null
    let lastAdrActual: number | null = null
    let firstForecastIndex: number | null = null

    // 選択された期間の日数を計算
    const startDate = new Date(2025, startMonthNum - 1, 1)
    const finalEndDate = new Date(2025, startMonthNum - 1 + displayMonthsNum, 0)
    const totalDays = Math.ceil((finalEndDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1

    return Array.from({ length: totalDays }, (_, i) => {
      const date = new Date(baseDate)
      date.setDate(date.getDate() + i)
      
      // 選択された期間の範囲を超えた場合はnullを返す
      const currentMonth = date.getMonth() + 1 // 1-12の範囲
      const endMonth = startMonthNum + displayMonthsNum - 1
      if (currentMonth < startMonthNum || currentMonth > endMonth) {
        return null
      }
      
      const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate())
      const isWeekend = date.getDay() === 0 || date.getDay() === 6

      // 今日より前か後かで実績/予測を判定
      const isFuture = dateOnly > todayDateOnly
      const isToday = dateOnly.getTime() === todayDateOnly.getTime()

      // 実績データ（今日まで）
      let occupancyActual: number | null = null
      let adrActual: number | null = null

      // 予測データ（今日以降）
      let occupancyForecast: number | null = null
      let adrForecast: number | null = null

      // ホテル業界の実際のパターンを反映したデータ生成
      // 曜日による変動（週末は稼働率・ADRが高い）
      const dayOfWeek = date.getDay()
      const isWeekendDay = dayOfWeek === 0 || dayOfWeek === 6
      
      // 月内の日付による変動（月初・月末は需要が高い傾向）
      const dayOfMonth = date.getDate()
      const currentMonthDays = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
      const monthProgress = dayOfMonth / currentMonthDays // 0-1の範囲
      
      // ベースライン値（月によって調整）
      const monthBaseOccupancy = 8000 + (startMonthNum - 1) * 300
      const monthBaseAdr = 15000 + (startMonthNum - 1) * 500
      
      // 週末効果
      const weekendBoostOccupancy = isWeekendDay ? 2000 : 0
      const weekendBoostAdr = isWeekendDay ? 2000 : 0
      
      // 月初・月末効果（ホテル業界では月初と月末に需要が高まる傾向）
      const monthEndBoost = monthProgress < 0.1 || monthProgress > 0.9 ? 1000 : 0
      
      // 日々の変動（ランダム要素を減らしてより現実的に）
      const dailyVariation = Math.sin(i * 0.2) * 500 + Math.random() * 300
      
      const baseOccupancy = monthBaseOccupancy + weekendBoostOccupancy + monthEndBoost + dailyVariation
      const baseAdr = monthBaseAdr + weekendBoostAdr + monthEndBoost + dailyVariation

      if (!isFuture) {
        // 実績データ
        occupancyActual = Math.max(0, Math.round(baseOccupancy))
        adrActual = Math.max(0, Math.round(baseAdr))
        lastOccupancyActual = occupancyActual
        lastAdrActual = adrActual
      } else {
        // 予測データ
        // 最初の予測日のインデックスを記録
        if (firstForecastIndex === null) {
          firstForecastIndex = i
        }

        // 予測の最初の点は、実績の最後の値と同じにする（連続させるため）
        if (i === firstForecastIndex && lastOccupancyActual !== null && lastAdrActual !== null) {
          occupancyForecast = lastOccupancyActual
          adrForecast = lastAdrActual
        } else {
          // 予測データ（2日目以降）- 実績データの傾向を継続
          occupancyForecast = Math.max(0, Math.round(baseOccupancy))
          adrForecast = Math.max(0, Math.round(baseAdr))
        }
      }

      return {
        date: `${date.getMonth() + 1}/${date.getDate()}`,
        occupancyActual,
        adrActual,
        occupancyForecast,
        adrForecast,
        isFuture,
        isToday,
      }
    }).filter((item) => item !== null) // nullを除外
  }, [chartStartMonth, chartDisplayMonths])

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-background border border-border rounded-lg shadow-lg p-3">
          <p className="text-sm font-medium mb-2">{payload[0].payload.date}</p>
          <div className="space-y-1">
            <p className="text-xs flex items-center gap-2">
              <span className="w-3 h-0.5 bg-blue-600"></span>
              <span>稼働数: {Math.round(payload[0].value).toLocaleString()}室</span>
            </p>
            <p className="text-xs flex items-center gap-2">
              <span className="w-3 h-0.5 bg-red-500"></span>
              <span>ADR: ¥{Math.round(payload[1].value).toLocaleString()}</span>
            </p>
          </div>
        </div>
      )
    }
    return null
  }

  return (
    <div className="p-4 space-y-4">
      <div className="space-y-4">
        {/* アラートセクション - 一番上に配置 */}
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-lg font-semibold">アラート</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-3">
              {/* 赤アラート（すぐに修正する） */}
              <div className="border-l-4 border-red-500 bg-red-50 dark:bg-red-950/20 p-3 rounded-r">
                <div className="flex items-start gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500 mt-1 flex-shrink-0"></div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold text-red-700 dark:text-red-400">すぐに修正する</span>
                      <button
                        onClick={() => onTabChange?.("daily")}
                        className="text-xs text-blue-600 hover:underline hover:text-blue-800 transition-colors"
                      >
                        2025/10/18 (日別分析へ)
                      </button>
                    </div>
                    <p className="text-sm text-red-800 dark:text-red-300">
                      ADRが目標値を下回っています。価格設定の見直しが必要です。
                    </p>
                  </div>
                </div>
              </div>

              {/* 黄アラート（1週間内での経過観察が必要） */}
              <div className="border-l-4 border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20 p-3 rounded-r">
                <div className="flex items-start gap-2">
                  <div className="w-3 h-3 rounded-full bg-yellow-500 mt-1 flex-shrink-0"></div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold text-yellow-700 dark:text-yellow-400">1週間内での経過観察が必要</span>
                      <button
                        onClick={() => onTabChange?.("daily")}
                        className="text-xs text-blue-600 hover:underline hover:text-blue-800 transition-colors"
                      >
                        2025/10/15 (日別分析へ)
                      </button>
                    </div>
                    <p className="text-sm text-yellow-800 dark:text-yellow-300">
                      稼働率が前年同期比で3%低下しています。需要動向を注視してください。
                    </p>
                  </div>
                </div>
              </div>

              <div className="border-l-4 border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20 p-3 rounded-r">
                <div className="flex items-start gap-2">
                  <div className="w-3 h-3 rounded-full bg-yellow-500 mt-1 flex-shrink-0"></div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold text-yellow-700 dark:text-yellow-400">1週間内での経過観察が必要</span>
                      <button
                        onClick={() => onTabChange?.("analysis")}
                        className="text-xs text-blue-600 hover:underline hover:text-blue-800 transition-colors"
                      >
                        2025/10/12 (各種分析へ)
                      </button>
                    </div>
                    <p className="text-sm text-yellow-800 dark:text-yellow-300">
                      ビジネスセグメントの予約が減少傾向です。プロモーション施策の検討を推奨します。
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* AI解説セクション */}
        <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200 dark:from-blue-950/30 dark:to-indigo-950/30 dark:border-blue-800">
          <CardHeader className="pb-1">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <span className="text-xl">🤖</span>
              AI解説
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2 text-sm leading-relaxed">
              <p>
                <span className="text-blue-700 dark:text-blue-300 font-medium">昨年稼働進捗と比較し同等の伸びになっています。</span>
                ただし
                <span className="text-red-600 dark:text-red-400 font-medium">海外需要が昨年より5%（パーセント）落ち込んでいます</span>
                が、それを
                <span className="text-blue-700 dark:text-blue-300 font-medium">東京オリンピック関連イベント絡みで国内需要がサポートしています</span>
                。
                <span className="text-blue-700 dark:text-blue-300 font-medium">2名以上の利用の伸びも昨年に比べ8%（パーセント）を上回る推移</span>
                で
                <span className="text-red-600 dark:text-red-400 font-medium">ビジネス層の鈍化を押し支えています</span>
                。
              </p>
              <p>
                <span className="text-blue-700 dark:text-blue-300 font-medium">ADRについては、10月末時点での予算達成は室料売上で101.6%（パーセント）の見込みで推移すると予測されます。</span>
              </p>
              <p>
                特に
                <span className="text-blue-700 dark:text-blue-300 font-medium">9/25～10/5の楽天トラベルのビジネスキャンペーン参画による効果</span>
                が
                <span className="text-blue-700 dark:text-blue-300 font-medium">10/4～10/10でビジネス（1名利用）需要が150室（室数）増加</span>
                しており、
                <span className="text-blue-700 dark:text-blue-300 font-medium">昨年と比べこの期間においては140%（パーセント）の伸び</span>
                を示しています。またこの期間の
                <span className="text-blue-700 dark:text-blue-300 font-medium">REV-Perでは118%（パーセント）</span>
                となっており、
                <span className="text-red-600 dark:text-red-400 font-medium">稼働室数優先でADRでは103%（パーセント）</span>
                なっています。
              </p>
            </div>
          </CardContent>
        </Card>

        {/* 稼働・ADR月間推移 */}
        <Card>
          <CardHeader className="pb-1">
            <div className="flex items-center justify-between mb-2">
              <div>
                <CardTitle className="text-lg font-semibold">稼働・ADR月間推移</CardTitle>
                <p className="text-xs text-muted-foreground">¥21,000（目標値）</p>
              </div>
              {/* 対象月・表示月数選択をコンパクトに配置 */}
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <Label className="text-xs whitespace-nowrap">対象月</Label>
                  <Select value={chartStartMonth} onValueChange={setChartStartMonth}>
                    <SelectTrigger className="w-20 h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 12 }, (_, i) => (
                        <SelectItem key={i + 1} value={String(i + 1)}>
                          {i + 1}月
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {showDisplayMonthsSelector && (
                  <div className="flex items-center gap-1.5">
                    <Label className="text-xs whitespace-nowrap">表示月数</Label>
                    <Select value={chartDisplayMonths} onValueChange={setChartDisplayMonths}>
                      <SelectTrigger className="w-24 h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1か月</SelectItem>
                        <SelectItem value="2">2か月</SelectItem>
                        <SelectItem value="3">3か月</SelectItem>
                        <SelectItem value="4">4か月</SelectItem>
                        <SelectItem value="6">6か月</SelectItem>
                        <SelectItem value="12">12か月</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-0.5 bg-blue-600"></div>
                    <span className="font-medium text-xs">稼働数</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-0.5 bg-red-500"></div>
                    <span className="font-medium text-xs">ADR</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="px-1.5 py-0.5 bg-muted rounded text-xs">実績</span>
                  <span>←</span>
                  <span className="px-1.5 py-0.5 bg-muted rounded text-xs">→</span>
                  <span className="px-1.5 py-0.5 bg-muted rounded text-xs">実績+予測</span>
                </div>
              </div>

              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={adrChartData} margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11 }}
                    interval={Number.parseInt(chartDisplayMonths) === 1 ? 2 : 4}
                    stroke="currentColor"
                    opacity={0.6}
                    label={{ value: '日付', position: 'insideBottom', offset: -5, style: { textAnchor: 'middle', fontSize: 12 } }}
                  />
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 12 }}
                    stroke="currentColor"
                    opacity={0.6}
                    tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`}
                    label={{ value: '稼働数（室）', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fontSize: 12 } }}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 12 }}
                    stroke="currentColor"
                    opacity={0.6}
                    tickFormatter={(value) => `¥${(value / 1000).toFixed(0)}k`}
                    label={{ value: 'ADR（円）', angle: 90, position: 'insideRight', style: { textAnchor: 'middle', fontSize: 12 } }}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  {/* 今日の日付を示す垂直線 */}
                  {adrChartData.find(d => d.isToday) && (
                    <ReferenceLine
                      x={adrChartData.find(d => d.isToday)?.date}
                      stroke="#666"
                      strokeDasharray="5 5"
                      strokeWidth={1.5}
                      label={{ value: `本日 ${adrChartData.find(d => d.isToday)?.date}`, position: "top", fill: "#666", fontSize: 11 }}
                    />
                  )}
                  {/* 稼働数 - 実績（今日まで） */}
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="occupancyActual"
                    stroke="#2563eb"
                    strokeWidth={2.5}
                    dot={false}
                    name="稼働数"
                    activeDot={{ r: 6 }}
                    connectNulls={false}
                  />
                  {/* 稼働数 - 予測（今日以降）点線 */}
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="occupancyForecast"
                    stroke="#2563eb"
                    strokeWidth={2.5}
                    strokeDasharray="5 5"
                    dot={false}
                    name="稼働数（予測）"
                    activeDot={{ r: 6 }}
                    connectNulls={false}
                  />
                  {/* ADR - 実績（今日まで） */}
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="adrActual"
                    stroke="#ef4444"
                    strokeWidth={2.5}
                    dot={false}
                    name="ADR"
                    activeDot={{ r: 6 }}
                    connectNulls={false}
                  />
                  {/* ADR - 予測（今日以降）点線 */}
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="adrForecast"
                    stroke="#ef4444"
                    strokeWidth={2.5}
                    strokeDasharray="5 5"
                    dot={false}
                    name="ADR（予測）"
                    activeDot={{ r: 6 }}
                    connectNulls={false}
                  />
                </LineChart>
              </ResponsiveContainer>

              <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
                <p>
                  表示期間: {Number.parseInt(chartDisplayMonths) === 1 
                    ? `${chartStartMonth}月（${adrChartData.length}日分）` 
                    : `${chartDisplayMonths}ヶ月分の推移`}
                </p>
                <div className="text-center">
                  <p className="text-xs font-medium">{chartStartMonth}月オンハンド</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 月初比較・日付比較セクション */}
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-lg font-semibold">月初比較・日付比較</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-muted-foreground">月初比較</h3>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">vs {chartStartMonth}月1日</span>
                </div>
                <div className="grid grid-cols-2 gap-y-4 gap-x-4">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">稼働率</p>
                    <p className="text-lg font-bold text-green-600 dark:text-green-400">+5.2%</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">ADR</p>
                    <p className="text-lg font-bold text-red-600 dark:text-red-400">-1,200円</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">予約室数</p>
                    <p className="text-lg font-bold">+45室</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">室料売上</p>
                    <p className="text-lg font-bold">+125.4万円</p>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-muted-foreground">日付比較</h3>
                  <div className="flex items-center gap-2">
                    <Select value={comparisonType} onValueChange={(value: "previousDay" | "weekAgo" | "lastMonth" | "custom") => {
                      setComparisonType(value)
                      if (value !== "custom") {
                        setCustomComparisonDate(undefined)
                      }
                    }}>
                      <SelectTrigger className="w-32 h-7 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="previousDay">前日</SelectItem>
                        <SelectItem value="weekAgo">1週間前</SelectItem>
                        <SelectItem value="lastMonth">先月同日</SelectItem>
                        <SelectItem value="custom">日付選択</SelectItem>
                      </SelectContent>
                    </Select>
                    {comparisonType === "custom" && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" size="sm" className="h-7 text-xs">
                            <CalendarIcon className="mr-1 h-3 w-3" />
                            {customComparisonDate ? format(customComparisonDate, "M/d", { locale: ja }) : "選択"}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="end">
                          <Calendar
                            mode="single"
                            selected={customComparisonDate}
                            onSelect={(date) => setCustomComparisonDate(date)}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  <span className="whitespace-nowrap">vs {format(comparisonDate, "M月d日", { locale: ja })}</span>
                </div>
                <div className="grid grid-cols-2 gap-y-4 gap-x-4">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">稼働率</p>
                    <p className="text-lg font-bold text-green-600 dark:text-green-400">+2.1%</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">ADR</p>
                    <p className="text-lg font-bold text-green-600 dark:text-green-400">+500円</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">予約室数</p>
                    <p className="text-lg font-bold">+12室</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">室料売上</p>
                    <p className="text-lg font-bold">+45.2万円</p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 伸び率の高いサイト上位3件 */}
        {showTopSitesSection && (
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-lg font-semibold">伸び率の高いサイト上位3件</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-4">
              {/* Site 1 */}
              <div className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-700 dark:text-blue-400 font-bold text-sm">1</div>
                  <div>
                    <p className="font-medium text-sm">楽天トラベル</p>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-green-600 dark:text-green-400 font-medium">前月比 +145%</span>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold text-lg">450<span className="text-sm font-normal ml-1">室</span></p>
                  <p className="text-xs text-muted-foreground">予約獲得</p>
                </div>
              </div>

              {/* Site 2 */}
              <div className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-700 dark:text-blue-400 font-bold text-sm">2</div>
                  <div>
                    <p className="font-medium text-sm">Booking.com</p>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-green-600 dark:text-green-400 font-medium">前月比 +120%</span>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold text-lg">320<span className="text-sm font-normal ml-1">室</span></p>
                  <p className="text-xs text-muted-foreground">予約獲得</p>
                </div>
              </div>

              {/* Site 3 */}
              <div className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-700 dark:text-blue-400 font-bold text-sm">3</div>
                  <div>
                    <p className="font-medium text-sm">一休.com</p>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-green-600 dark:text-green-400 font-medium">前月比 +115%</span>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold text-lg">180<span className="text-sm font-normal ml-1">室</span></p>
                  <p className="text-xs text-muted-foreground">予約獲得</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        )}

        {/* KPI進捗状況 */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">KPI進捗状況</h2>
            <p className="text-xs text-muted-foreground">10月19日現在</p>
          </div>

          {/* 開始月選択と客室数をコンパクトに配置 */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1.5">
                <Label className="text-xs whitespace-nowrap">開始月選択</Label>
                <Select value={displayMonth} onValueChange={setDisplayMonth}>
                  <SelectTrigger className="w-20 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 12 }, (_, i) => (
                      <SelectItem key={i + 1} value={String(i + 1)}>
                        {i + 1}月
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-1.5">
                <Label className="text-xs whitespace-nowrap">表示月数</Label>
                <Select value={displayMonths} onValueChange={setDisplayMonths}>
                  <SelectTrigger className="w-24 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1か月</SelectItem>
                    <SelectItem value="2">2か月</SelectItem>
                    <SelectItem value="3">3か月</SelectItem>
                    <SelectItem value="4">4か月</SelectItem>
                    <SelectItem value="6">6か月</SelectItem>
                    <SelectItem value="12">12か月</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 rounded-md">
              <p className="text-xs text-muted-foreground">客室数</p>
              <div className="text-lg font-bold">1,280<span className="text-sm font-semibold ml-0.5">室</span></div>
            </div>
          </div>

          {/* 各月ごとのKPIテーブルを縦に並べて表示 */}
          <div className="space-y-4">
            {monthlyKpiData.map((monthData) => (
              <Card key={monthData.month}>
                <CardContent className="p-0 pt-2 pb-2">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="text-center py-1 px-1.5 font-medium border-r" rowSpan={2}>
                            {monthData.monthLabel}
                          </th>
                          <th className="text-center py-1 px-1.5 font-medium border-r" rowSpan={2}>
                            オンハンド
                          </th>
                          <th className="text-center py-1 px-1.5 font-medium border-r" colSpan={3}>
                            予算比
                          </th>
                          <th className="text-center py-1 px-1.5 font-medium border-r" colSpan={3}>
                            前年比
                          </th>
                          <th className="text-center py-1 px-1.5 font-medium border-r" rowSpan={2}>
                            オンハンド
                            <br />
                            AI予測値
                          </th>
                          <th className="text-center py-1 px-1.5 font-medium border-r" rowSpan={2}>
                            予算比
                          </th>
                          <th className="text-center py-1 px-1.5 font-medium border-r" rowSpan={2}>
                            前年比
                          </th>
                        </tr>
                        <tr className="border-b bg-muted/30">
                          <th className="text-center py-1 px-1.5 text-xs font-medium border-r">
                            本日まで
                          </th>
                          <th className="text-center py-1 px-1.5 text-xs font-medium border-r">
                            累計進捗
                          </th>
                          <th className="text-center py-1 px-1.5 text-xs font-medium border-r">
                            本日まで
                          </th>
                          <th className="text-center py-1 px-1.5 text-xs font-medium border-r">
                            累計進捗
                          </th>
                          <th className="text-center py-1 px-1.5 text-xs font-medium border-r">
                            年度累計
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {monthData.kpiRows.map((row, index) => (
                          <tr key={index} className="border-b hover:bg-muted/20">
                            <td className="py-1 px-1.5 font-medium border-r bg-muted/10">{row.label}</td>
                            <td className="text-right py-1 px-1.5 font-semibold border-r">{row.onHand}</td>
                            <td className="text-right py-1 px-1.5 border-r">{row.budgetProgress}</td>
                            <td
                              className={`text-right py-1 px-1.5 border-r font-medium ${row.budgetComparisonNegative ? "text-[color:var(--negative)]" : ""}`}
                            >
                              {row.budgetComparison}
                            </td>
                            <td className="text-right py-1 px-1.5 border-r bg-muted/5">{row.annualBudgetRatio}</td>
                            <td className="text-right py-1 px-1.5 border-r">{row.lastYearProgress}</td>
                            <td
                              className={`text-right py-1 px-1.5 border-r font-medium ${row.lastYearComparisonNegative ? "text-[color:var(--negative)]" : ""}`}
                            >
                              {row.lastYearComparison}
                            </td>
                            <td className="text-right py-1 px-1.5 border-r bg-muted/5">{row.annualLastYearRatio}</td>
                            <td className="text-right py-1 px-1.5 border-r font-semibold text-green-600 dark:text-green-400">
                              {row.aiPrediction}
                            </td>
                            <td
                              className={`text-right py-1 px-1.5 border-r ${parseFloat(row.aiBudgetRatio) < 100 ? "text-[color:var(--negative)]" : ""}`}
                            >
                              {row.aiBudgetRatio}
                            </td>
                            <td
                              className={`text-right py-1 px-1.5 ${parseFloat(row.aiLastYearRatio) < 100 ? "text-[color:var(--negative)]" : ""}`}
                            >
                              {row.aiLastYearRatio}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}
