"use client"

// 設定タブ（U-11 / U-12 / U-15）
//
// 保存先が無い（＝入力しても捨てられる）設定は置かない方針。
//  - ホテル情報・料金ランク: バックエンドに保存（各カードが担当）
//  - テーマ: next-themes が localStorage に保存し、実際に画面へ反映される
//  - ダッシュボード表示設定 / KPI表示項目: このブラウザの localStorage に保存し、
//    ダッシュボードが実際に読み取って表示を変える
// 以前あった「表示設定（言語・日付形式・通貨・数値形式）」「通知設定」「システム設定」は
// 保存も反映もされない見せかけの設定だったため撤去した。

import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import { Save } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { useAuth } from "@/components/auth-provider"
import { HotelSettingsCard } from "@/components/settings/hotel-settings-card"
import { PriceRankSection } from "@/components/settings/price-rank-section"
import { BudgetSection } from "@/components/settings/budget-section"

// ダッシュボードKPI進捗表に表示する指標（施設ごとに選択可能。F-DASH-01）
const DASHBOARD_KPI_ITEMS = [
  { key: "roomRevenue", label: "室料売上" },
  { key: "soldRooms", label: "販売室数" },
  { key: "adr", label: "ADR" },
  { key: "occupancyRate", label: "稼働率" },
  { key: "revPar", label: "REV-Per" },
  { key: "guests", label: "宿泊人数" },
  { key: "dor", label: "DOR" },
  { key: "guestUnitPrice", label: "客単価" },
] as const

const ALL_DASHBOARD_KPI_KEYS: string[] = DASHBOARD_KPI_ITEMS.map((item) => item.key)

const TOP_SITES_KEY = "dashboard.showTopSitesSection"

// localStorage キー（hotelId ごとに保存。将来 Hotel の設定APIへ移行予定）
const dashboardKpiItemsKey = (hotelId: string) => `dashboard.kpiItems.${hotelId}`

function parseDashboardKpiItems(raw: string | null): string[] {
  if (!raw) return ALL_DASHBOARD_KPI_KEYS
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return ALL_DASHBOARD_KPI_KEYS
    const keys = parsed.filter(
      (v): v is string => typeof v === "string" && ALL_DASHBOARD_KPI_KEYS.includes(v),
    )
    return keys.length > 0 ? keys : ALL_DASHBOARD_KPI_KEYS
  } catch {
    return ALL_DASHBOARD_KPI_KEYS
  }
}

export function SettingsTab() {
  const { hotelId } = useAuth()
  const { theme, setTheme } = useTheme()
  // next-themes はマウント後にしか実際のテーマを知らないため、SSRとの不一致を避ける
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // ダッシュボード表示設定（このブラウザにのみ保存。ダッシュボードが読み取る）
  const [showTopSitesSection, setShowTopSitesSection] = useState(false)
  const [dashboardKpiItems, setDashboardKpiItems] = useState<string[]>(ALL_DASHBOARD_KPI_KEYS)

  useEffect(() => {
    if (typeof window === "undefined") return
    setShowTopSitesSection(localStorage.getItem(TOP_SITES_KEY) === "true")
  }, [])

  useEffect(() => {
    if (typeof window === "undefined" || !hotelId) return
    setDashboardKpiItems(parseDashboardKpiItems(localStorage.getItem(dashboardKpiItemsKey(hotelId))))
  }, [hotelId])

  const toggleDashboardKpiItem = (key: string, checked: boolean) => {
    setDashboardKpiItems((prev) => {
      if (checked) {
        if (prev.includes(key)) return prev
        // 定数の並び順を保つ
        return ALL_DASHBOARD_KPI_KEYS.filter((k) => k === key || prev.includes(k))
      }
      return prev.filter((k) => k !== key)
    })
  }

  /** 表示設定はこのブラウザに保存し、その場でダッシュボードへ通知する */
  const handleSaveDisplaySettings = () => {
    if (typeof window === "undefined" || !hotelId || dashboardKpiItems.length === 0) return
    localStorage.setItem(TOP_SITES_KEY, String(showTopSitesSection))
    localStorage.setItem(dashboardKpiItemsKey(hotelId), JSON.stringify(dashboardKpiItems))
    window.dispatchEvent(new Event("settingsUpdated"))
    toast.success("表示設定を保存しました", {
      description: "ダッシュボードに反映されます（この端末のブラウザにのみ保存されます）。",
    })
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="font-heading text-2xl font-medium tracking-tight">設定</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          ホテル情報・料金ランク・予算・競合ホテル・ユーザー・画面表示の設定を管理します
        </p>
      </div>

      <HotelSettingsCard />

      <PriceRankSection />

      <BudgetSection />

      {/* 外観（テーマ）— next-themes が localStorage に保存し、即座に反映される */}
      <Card>
        <CardHeader>
          <CardTitle>外観</CardTitle>
          <CardDescription>
            画面のテーマを切り替えます（この端末のブラウザにのみ保存されます）
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3">
            <Label htmlFor="theme" className="whitespace-nowrap">
              テーマ
            </Label>
            <Select
              value={mounted ? (theme ?? "system") : "system"}
              onValueChange={setTheme}
              disabled={!mounted}
            >
              <SelectTrigger id="theme" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">ライト</SelectItem>
                <SelectItem value="dark">ダーク</SelectItem>
                <SelectItem value="system">システム設定に従う</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* ダッシュボード表示設定 */}
      <Card>
        <CardHeader>
          <CardTitle>ダッシュボード表示設定</CardTitle>
          <CardDescription>
            ダッシュボードに表示するセクションとKPI項目を選びます。この端末のブラウザにのみ保存されます。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="showTopSitesSection">「伸び率の高いサイト上位3件」を表示</Label>
              <p className="text-sm text-muted-foreground">
                OTA連携が未実装のため、現在は「今後提供予定」の枠のみが表示されます
              </p>
            </div>
            <Switch
              id="showTopSitesSection"
              checked={showTopSitesSection}
              onCheckedChange={setShowTopSitesSection}
            />
          </div>

          <Separator />

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium leading-none">KPI進捗表に表示する指標</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
              {DASHBOARD_KPI_ITEMS.map((item) => (
                <div key={item.key} className="flex items-center gap-2">
                  <Checkbox
                    id={`dashboard-kpi-${item.key}`}
                    checked={dashboardKpiItems.includes(item.key)}
                    onCheckedChange={(checked) => toggleDashboardKpiItem(item.key, checked === true)}
                  />
                  <Label htmlFor={`dashboard-kpi-${item.key}`} className="font-normal">
                    {item.label}
                  </Label>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">
                {dashboardKpiItems.length === 0
                  ? "1項目以上選択してください"
                  : `${dashboardKpiItems.length}項目を表示します`}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDashboardKpiItems(ALL_DASHBOARD_KPI_KEYS)}
                  disabled={dashboardKpiItems.length === DASHBOARD_KPI_ITEMS.length}
                >
                  すべて選択
                </Button>
                <Button
                  size="sm"
                  className="gap-2"
                  onClick={handleSaveDisplaySettings}
                  disabled={dashboardKpiItems.length === 0 || !hotelId}
                >
                  <Save className="h-4 w-4" aria-hidden />
                  表示設定を保存
                </Button>
              </div>
            </div>
          </fieldset>
        </CardContent>
      </Card>
    </div>
  )
}
