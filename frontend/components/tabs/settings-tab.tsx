"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { useToast } from "@/hooks/use-toast"

export function SettingsTab() {
  const { toast } = useToast()

  // ホテル情報設定
  const [hotelName, setHotelName] = useState("サンプルホテル")
  const [hotelAddress, setHotelAddress] = useState("東京都千代田区1-1-1")
  const [totalRooms, setTotalRooms] = useState(1280)
  const [contactEmail, setContactEmail] = useState("contact@hotel.example.com")
  const [contactPhone, setContactPhone] = useState("03-1234-5678")

  // 表示設定
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system")
  const [language, setLanguage] = useState("ja")
  const [dateFormat, setDateFormat] = useState("YYYY/MM/DD")
  const [currency, setCurrency] = useState("JPY")
  const [numberFormat, setNumberFormat] = useState("ja-JP")

  // 通知設定
  const [emailNotifications, setEmailNotifications] = useState(true)
  const [alertThreshold, setAlertThreshold] = useState(95)
  const [dailyReport, setDailyReport] = useState(true)
  const [weeklyReport, setWeeklyReport] = useState(true)

  // システム設定
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

  const handleSave = () => {
    // localStorageに設定を保存
    if (typeof window !== "undefined") {
      localStorage.setItem("dashboard.showDisplayMonthsSelector", String(showDisplayMonthsSelector))
      localStorage.setItem("dashboard.showTopSitesSection", String(showTopSitesSection))
      // 同じウィンドウ内で設定変更を通知
      window.dispatchEvent(new Event("settingsUpdated"))
    }
    // TODO: API呼び出しで設定を保存
    toast({
      title: "設定を保存しました",
      description: "変更が正常に保存されました。",
    })
  }

  const handleReset = () => {
    // デフォルト値にリセット
    setHotelName("サンプルホテル")
    setHotelAddress("東京都千代田区1-1-1")
    setTotalRooms(1280)
    setContactEmail("contact@hotel.example.com")
    setContactPhone("03-1234-5678")
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

    toast({
      title: "設定をリセットしました",
      description: "すべての設定がデフォルト値に戻りました。",
    })
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">設定</h1>
          <p className="text-sm text-muted-foreground mt-1">システムの各種設定を管理できます</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleReset}>
            リセット
          </Button>
          <Button onClick={handleSave}>保存</Button>
        </div>
      </div>

      {/* ホテル情報設定 */}
      <Card>
        <CardHeader>
          <CardTitle>ホテル情報</CardTitle>
          <CardDescription>ホテルの基本情報を設定します</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="hotelName">ホテル名</Label>
              <Input
                id="hotelName"
                value={hotelName}
                onChange={(e) => setHotelName(e.target.value)}
                placeholder="ホテル名を入力"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="totalRooms">総客室数</Label>
              <Input
                id="totalRooms"
                type="number"
                value={totalRooms}
                onChange={(e) => setTotalRooms(Number.parseInt(e.target.value))}
                placeholder="1280"
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="hotelAddress">住所</Label>
              <Input
                id="hotelAddress"
                value={hotelAddress}
                onChange={(e) => setHotelAddress(e.target.value)}
                placeholder="住所を入力"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contactEmail">連絡先メールアドレス</Label>
              <Input
                id="contactEmail"
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="contact@hotel.example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contactPhone">連絡先電話番号</Label>
              <Input
                id="contactPhone"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="03-1234-5678"
              />
            </div>
          </div>
        </CardContent>
      </Card>

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
    </div>
  )
}
