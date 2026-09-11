"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Checkbox } from "@/components/ui/checkbox"
import { Save } from "lucide-react"
import { toast } from "sonner"
import { ConfirmDialog } from "@/components/confirm-dialog"

import { useAuth } from "@/components/auth-provider"
import { HotelSettingsCard } from "@/components/settings/hotel-settings-card"
import { PriceRankSection } from "@/components/settings/price-rank-section"

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

  // 表示設定（バックエンド未対応のためlocalStorageのまま）
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system")
  const [language, setLanguage] = useState("ja")
  const [dateFormat, setDateFormat] = useState("YYYY/MM/DD")
  const [currency, setCurrency] = useState("JPY")
  const [numberFormat, setNumberFormat] = useState("ja-JP")

  // 通知設定（バックエンド未対応のためlocalStorageのまま）
  const [emailNotifications, setEmailNotifications] = useState(true)
  const [alertThreshold, setAlertThreshold] = useState(95)
  const [dailyReport, setDailyReport] = useState(true)
  const [weeklyReport, setWeeklyReport] = useState(true)

  // システム設定（バックエンド未対応のためlocalStorageのまま）
  const [autoPriceUpdate, setAutoPriceUpdate] = useState(false)
  const [priceUpdateInterval, setPriceUpdateInterval] = useState("1")
  const [dataRetentionDays, setDataRetentionDays] = useState(365)

  // ダッシュボード設定
  const [showDisplayMonthsSelector, setShowDisplayMonthsSelector] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("dashboard.showDisplayMonthsSelector")
      return saved ? saved === "true" : false
    }
    return false
  })
  const [showTopSitesSection, setShowTopSitesSection] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("dashboard.showTopSitesSection")
      return saved ? saved === "true" : false
    }
    return false
  })

  // ダッシュボードKPI表示項目（対応APIが未実装のためlocalStorageのまま。F-DASH-01）
  const [dashboardKpiItems, setDashboardKpiItems] = useState<string[]>(ALL_DASHBOARD_KPI_KEYS)

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

  const handleSaveDashboardKpiItems = () => {
    if (typeof window === "undefined" || !hotelId || dashboardKpiItems.length === 0) return
    localStorage.setItem(dashboardKpiItemsKey(hotelId), JSON.stringify(dashboardKpiItems))
    window.dispatchEvent(new Event("settingsUpdated"))
    toast.success("KPI表示項目を保存しました", {
      description: "ダッシュボードのKPI進捗表に反映されます。",
    })
  }

  const handleSave = () => {
    // ホテル情報・料金ランクは各カードが自前で保存する。ここは表示設定（ブラウザ保存）のみ。
    if (typeof window !== "undefined") {
      localStorage.setItem("dashboard.showDisplayMonthsSelector", String(showDisplayMonthsSelector))
      localStorage.setItem("dashboard.showTopSitesSection", String(showTopSitesSection))
      window.dispatchEvent(new Event("settingsUpdated"))
    }
    toast.success("表示設定を保存しました", {
      description: "このブラウザにのみ保存されます。",
    })
  }

  // 設定リセットの確認ダイアログ（F-5）
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)

  const handleReset = () => {
    setTheme("system")
    setLanguage("ja")
    setDateFormat("YYYY/MM/DD")
    setCurrency("JPY")
    setNumberFormat("ja-JP")
    setEmailNotifications(true)
    setAlertThreshold(95)
    setDailyReport(true)
    setWeeklyReport(true)
    setAutoPriceUpdate(false)
    setPriceUpdateInterval("1")
    setDataRetentionDays(365)
    setShowDisplayMonthsSelector(false)
    setShowTopSitesSection(false)
    setDashboardKpiItems(ALL_DASHBOARD_KPI_KEYS)

    toast.success("表示設定をリセットしました")
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      {/* 設定リセットの確認（F-5） */}
      <ConfirmDialog
        open={resetConfirmOpen}
        onOpenChange={setResetConfirmOpen}
        title="設定をリセットしますか？"
        description="入力中の内容を破棄し、すべての設定を初期値に戻します。この操作は取り消せません。"
        confirmLabel="リセットする"
        onConfirm={() => {
          setResetConfirmOpen(false)
          handleReset()
        }}
      />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-medium tracking-tight">設定</h1>
          <p className="text-sm text-muted-foreground mt-1">システムの各種設定を管理できます</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setResetConfirmOpen(true)}>
            リセット
          </Button>
          <Button onClick={handleSave}>保存</Button>
        </div>
      </div>

      <HotelSettingsCard />

      <PriceRankSection />

      {/* 表示設定 */}
      <Card>
        <CardHeader>
          <CardTitle>表示設定</CardTitle>
          <CardDescription>画面表示に関する設定を行います</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="theme">テーマ</Label>
              <Select value={theme} onValueChange={(value: "light" | "dark" | "system") => setTheme(value)}>
                <SelectTrigger id="theme">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">ライト</SelectItem>
                  <SelectItem value="dark">ダーク</SelectItem>
                  <SelectItem value="system">システム設定に従う</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="language">言語</Label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger id="language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ja">日本語</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="dateFormat">日付形式</Label>
              <Select value={dateFormat} onValueChange={setDateFormat}>
                <SelectTrigger id="dateFormat">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="YYYY/MM/DD">YYYY/MM/DD</SelectItem>
                  <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
                  <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="currency">通貨</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger id="currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="JPY">JPY (円)</SelectItem>
                  <SelectItem value="USD">USD ($)</SelectItem>
                  <SelectItem value="EUR">EUR (€)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="numberFormat">数値形式</Label>
              <Select value={numberFormat} onValueChange={setNumberFormat}>
                <SelectTrigger id="numberFormat">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ja-JP">日本語形式 (1,234.56)</SelectItem>
                  <SelectItem value="en-US">英語形式 (1,234.56)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 通知設定 */}
      <Card>
        <CardHeader>
          <CardTitle>通知設定</CardTitle>
          <CardDescription>アラートとレポートの通知設定を行います</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="emailNotifications">メール通知</Label>
              <p className="text-sm text-muted-foreground">重要なアラートをメールで受け取る</p>
            </div>
            <Switch
              id="emailNotifications"
              checked={emailNotifications}
              onCheckedChange={setEmailNotifications}
            />
          </div>
          <Separator />
          <div className="space-y-2">
            <Label htmlFor="alertThreshold">アラート閾値 (%)</Label>
            <Input
              id="alertThreshold"
              type="number"
              min="0"
              max="100"
              value={alertThreshold}
              onChange={(e) => setAlertThreshold(Number.parseInt(e.target.value))}
            />
            <p className="text-sm text-muted-foreground">この値を下回るとアラートが発動します</p>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="dailyReport">日次レポート</Label>
              <p className="text-sm text-muted-foreground">毎日のレポートをメールで受け取る</p>
            </div>
            <Switch id="dailyReport" checked={dailyReport} onCheckedChange={setDailyReport} />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="weeklyReport">週次レポート</Label>
              <p className="text-sm text-muted-foreground">毎週のレポートをメールで受け取る</p>
            </div>
            <Switch id="weeklyReport" checked={weeklyReport} onCheckedChange={setWeeklyReport} />
          </div>
        </CardContent>
      </Card>

      {/* システム設定 */}
      <Card>
        <CardHeader>
          <CardTitle>システム設定</CardTitle>
          <CardDescription>システムの動作に関する設定を行います</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="autoPriceUpdate">自動価格更新</Label>
              <p className="text-sm text-muted-foreground">AI予測に基づいて自動的に価格を更新する</p>
            </div>
            <Switch id="autoPriceUpdate" checked={autoPriceUpdate} onCheckedChange={setAutoPriceUpdate} />
          </div>
          {autoPriceUpdate && (
            <>
              <Separator />
              <div className="space-y-2">
                <Label htmlFor="priceUpdateInterval">価格更新間隔 (時間)</Label>
                <Select value={priceUpdateInterval} onValueChange={setPriceUpdateInterval}>
                  <SelectTrigger id="priceUpdateInterval">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1時間</SelectItem>
                    <SelectItem value="3">3時間</SelectItem>
                    <SelectItem value="6">6時間</SelectItem>
                    <SelectItem value="12">12時間</SelectItem>
                    <SelectItem value="24">24時間</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
          <Separator />
          <div className="space-y-2">
            <Label htmlFor="dataRetentionDays">データ保持期間 (日)</Label>
            <Input
              id="dataRetentionDays"
              type="number"
              min="30"
              max="3650"
              value={dataRetentionDays}
              onChange={(e) => setDataRetentionDays(Number.parseInt(e.target.value))}
            />
            <p className="text-sm text-muted-foreground">過去のデータを保持する日数を設定します</p>
          </div>
        </CardContent>
      </Card>

      {/* ダッシュボード設定 */}
      <Card>
        <CardHeader>
          <CardTitle>ダッシュボード設定</CardTitle>
          <CardDescription>ダッシュボードの表示に関する設定を行います</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="showDisplayMonthsSelector">表示月数選択の表示</Label>
              <p className="text-sm text-muted-foreground">稼働・ADRグラフの表示月数選択ドロップダウンを表示する</p>
            </div>
            <Switch
              id="showDisplayMonthsSelector"
              checked={showDisplayMonthsSelector}
              onCheckedChange={setShowDisplayMonthsSelector}
            />
          </div>
          {!showDisplayMonthsSelector && (
            <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
              <p>表示月数選択が非表示の場合、グラフは常に1ヶ月分のデータを表示します。</p>
            </div>
          )}
          <Separator />
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="showTopSitesSection">伸び率の高いサイトセクションの表示</Label>
              <p className="text-sm text-muted-foreground">ダッシュボードに「伸び率の高いサイト上位3件」セクションを表示する</p>
            </div>
            <Switch
              id="showTopSitesSection"
              checked={showTopSitesSection}
              onCheckedChange={setShowTopSitesSection}
            />
          </div>
        </CardContent>
      </Card>

      {/* ダッシュボードKPI表示項目 */}
      <Card>
        <CardHeader>
          <CardTitle>ダッシュボードKPI表示項目</CardTitle>
          <CardDescription>
            ダッシュボードのKPI進捗表に表示する指標を選択します。施設ごとに保存されます。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
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
          <div className="flex items-center justify-between gap-4">
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
                onClick={handleSaveDashboardKpiItems}
                disabled={dashboardKpiItems.length === 0 || !hotelId}
              >
                <Save className="w-4 h-4" />
                保存
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
