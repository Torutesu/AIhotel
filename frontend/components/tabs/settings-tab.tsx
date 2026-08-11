"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { AlertCircle, Edit2, Loader2, RefreshCw, Save } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

import { useAuth } from "@/components/auth-provider"
import { DataIngestPanel } from "@/components/data-ingest-panel"
import {
  api,
  ApiClientError,
  type PriceRank,
  type RateCategory,
  type RoomTypeOption,
} from "@/lib/api"

// レート区分（販売料金表の行区分）
const RATE_CATEGORIES: Array<{ value: RateCategory; label: string }> = [
  { value: "OWN", label: "自社" },
  { value: "MEMBER", label: "会員" },
  { value: "SHAREHOLDER", label: "株優" },
  { value: "OTA", label: "OTA" },
]
import type { Hotel } from "@shared/types"

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"]
const DEFAULT_WEEKEND_DAYS = [5, 6] // 金・土（要件定義書 §4）

function parseWeekendDays(value: unknown): number[] {
  if (Array.isArray(value)) {
    const days = value.filter((v): v is number => typeof v === "number" && v >= 0 && v <= 6)
    if (days.length > 0) return days
  }
  return DEFAULT_WEEKEND_DAYS
}

export function SettingsTab() {
  const { toast } = useToast()
  const { hotelId, user } = useAuth()
  const canManageHotel = user?.role === "ADMIN" || user?.role === "MANAGER"

  // ホテル情報設定（実データ — F-SET-01）
  const [hotel, setHotel] = useState<Hotel | null>(null)
  const [hotelLoading, setHotelLoading] = useState(true)
  const [hotelError, setHotelError] = useState<string | null>(null)
  const [savingHotel, setSavingHotel] = useState(false)

  const [hotelName, setHotelName] = useState("")
  const [hotelAddress, setHotelAddress] = useState("")
  const [totalRooms, setTotalRooms] = useState(0)
  const [contactEmail, setContactEmail] = useState("")
  const [contactPhone, setContactPhone] = useState("")
  const [weekendDays, setWeekendDays] = useState<number[]>(DEFAULT_WEEKEND_DAYS)

  const loadHotel = useCallback(async () => {
    if (!hotelId) return
    setHotelLoading(true)
    setHotelError(null)
    try {
      const hotels = await api.hotels()
      const found = hotels.find((h) => h.id === hotelId) ?? null
      if (!found) throw new ApiClientError(404, "ホテル情報が見つかりません")
      setHotel(found)
      setHotelName(found.name)
      setHotelAddress(found.address ?? "")
      setTotalRooms(found.totalRooms)
      setContactEmail(found.email ?? "")
      setContactPhone(found.phone ?? "")
      setWeekendDays(parseWeekendDays(found.weekendDays))
    } catch (err) {
      setHotelError(err instanceof ApiClientError ? err.message : "ホテル情報の取得に失敗しました")
    } finally {
      setHotelLoading(false)
    }
  }, [hotelId])

  useEffect(() => {
    loadHotel()
  }, [loadHotel])

  const toggleWeekendDay = (day: number, checked: boolean) => {
    setWeekendDays((prev) => {
      if (checked) return prev.includes(day) ? prev : [...prev, day].sort()
      return prev.filter((d) => d !== day)
    })
  }

  // 料金ランク設定（実データ — F-SET-02）
  // 販売料金表と同じ「部屋タイプ × レート区分 × ランクコード」構造で表示する
  const [roomTypes, setRoomTypes] = useState<RoomTypeOption[]>([])
  const [rankRoomTypeId, setRankRoomTypeId] = useState<string>("")
  const [rankRateCategory, setRankRateCategory] = useState<RateCategory>("OWN")
  const [priceRanks, setPriceRanks] = useState<PriceRank[]>([])
  const [priceRanksLoading, setPriceRanksLoading] = useState(true)
  const [priceRanksError, setPriceRanksError] = useState<string | null>(null)
  const [editingRank, setEditingRank] = useState<PriceRank | null>(null)
  const [editPrice, setEditPrice] = useState(0)
  const [savingRank, setSavingRank] = useState(false)

  // 部屋タイプはマスタから取得する（選択肢のハードコード禁止）。
  // 既定は「料金表が登録されている最初のタイプ」— マスタ先頭は料金表を持たない場合があるため。
  useEffect(() => {
    if (!hotelId) return
    let cancelled = false
    Promise.all([api.roomTypes(hotelId), api.priceRanks(hotelId, { rateCategory: "OWN" })])
      .then(([list, ranks]) => {
        if (cancelled) return
        setRoomTypes(list)
        setRankRoomTypeId((prev) => prev || ranks[0]?.roomTypeId || list[0]?.id || "")
      })
      .catch(() => {
        /* 料金ランク側のエラー表示に集約する */
      })
    return () => {
      cancelled = true
    }
  }, [hotelId])

  const loadPriceRanks = useCallback(async () => {
    if (!hotelId || !rankRoomTypeId) return
    setPriceRanksLoading(true)
    setPriceRanksError(null)
    try {
      const result = await api.priceRanks(hotelId, {
        roomTypeId: rankRoomTypeId,
        rateCategory: rankRateCategory,
      })
      setPriceRanks(result)
    } catch (err) {
      setPriceRanksError(err instanceof ApiClientError ? err.message : "料金ランクの取得に失敗しました")
    } finally {
      setPriceRanksLoading(false)
    }
  }, [hotelId, rankRoomTypeId, rankRateCategory])

  useEffect(() => {
    loadPriceRanks()
  }, [loadPriceRanks])

  const openEditRank = (rank: PriceRank) => {
    setEditingRank(rank)
    setEditPrice(rank.price)
  }

  const handleSaveRank = async () => {
    if (!hotelId || !editingRank) return
    setSavingRank(true)
    try {
      await api.updatePriceRank(editingRank.id, hotelId, { price: editPrice })
      toast({ title: "料金ランクを更新しました" })
      setEditingRank(null)
      await loadPriceRanks()
    } catch (err) {
      toast({
        title: "料金ランクの更新に失敗しました",
        description: err instanceof ApiClientError ? err.message : undefined,
        variant: "destructive",
      })
    } finally {
      setSavingRank(false)
    }
  }

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

  const handleSave = async () => {
    // localStorageに設定を保存（バックエンド未対応の項目）
    if (typeof window !== "undefined") {
      localStorage.setItem("dashboard.showDisplayMonthsSelector", String(showDisplayMonthsSelector))
      localStorage.setItem("dashboard.showTopSitesSection", String(showTopSitesSection))
      window.dispatchEvent(new Event("settingsUpdated"))
    }

    if (canManageHotel && hotelId) {
      setSavingHotel(true)
      try {
        const updated = await api.updateHotelSettings(hotelId, {
          name: hotelName,
          address: hotelAddress,
          phone: contactPhone,
          email: contactEmail,
          totalRooms,
          weekendDays,
        })
        setHotel(updated)
        toast({
          title: "設定を保存しました",
          description: "変更が正常に保存されました。",
        })
      } catch (err) {
        toast({
          title: "ホテル設定の保存に失敗しました",
          description: err instanceof ApiClientError ? err.message : undefined,
          variant: "destructive",
        })
      } finally {
        setSavingHotel(false)
      }
    } else {
      toast({
        title: "設定を保存しました",
        description: "変更が正常に保存されました。",
      })
    }
  }

  const handleReset = () => {
    if (hotel) {
      setHotelName(hotel.name)
      setHotelAddress(hotel.address ?? "")
      setTotalRooms(hotel.totalRooms)
      setContactEmail(hotel.email ?? "")
      setContactPhone(hotel.phone ?? "")
      setWeekendDays(parseWeekendDays(hotel.weekendDays))
    }
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
          <Button onClick={handleSave} disabled={savingHotel}>
            {savingHotel ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            保存
          </Button>
        </div>
      </div>

      {/* ホテル情報設定 */}
      <Card>
        <CardHeader>
          <CardTitle>ホテル情報</CardTitle>
          <CardDescription>
            ホテルの基本情報を設定します
            {!canManageHotel && "（変更にはMANAGER以上の権限が必要です）"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {hotelLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : hotelError ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <AlertCircle className="w-6 h-6 text-destructive" />
              <p className="text-sm text-muted-foreground">{hotelError}</p>
              <Button variant="outline" size="sm" onClick={loadHotel} className="gap-2">
                <RefreshCw className="w-4 h-4" />
                再試行
              </Button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="hotelName">ホテル名</Label>
                  <Input
                    id="hotelName"
                    value={hotelName}
                    onChange={(e) => setHotelName(e.target.value)}
                    placeholder="ホテル名を入力"
                    disabled={!canManageHotel}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="totalRooms">総客室数</Label>
                  <Input
                    id="totalRooms"
                    type="number"
                    value={totalRooms}
                    onChange={(e) => setTotalRooms(Number.parseInt(e.target.value) || 0)}
                    placeholder="1280"
                    disabled={!canManageHotel}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="hotelAddress">住所</Label>
                  <Input
                    id="hotelAddress"
                    value={hotelAddress}
                    onChange={(e) => setHotelAddress(e.target.value)}
                    placeholder="住所を入力"
                    disabled={!canManageHotel}
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
                    disabled={!canManageHotel}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contactPhone">連絡先電話番号</Label>
                  <Input
                    id="contactPhone"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    placeholder="03-1234-5678"
                    disabled={!canManageHotel}
                  />
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <Label>週末定義</Label>
                <p className="text-sm text-muted-foreground">
                  稼働率・ADR等の集計で「週末」として扱う曜日を選択します（デフォルト: 金・土）
                </p>
                <div className="flex flex-wrap gap-4 pt-1">
                  {WEEKDAY_LABELS.map((label, day) => (
                    <div key={day} className="flex items-center gap-2">
                      <Checkbox
                        id={`weekend-day-${day}`}
                        checked={weekendDays.includes(day)}
                        onCheckedChange={(checked) => toggleWeekendDay(day, checked === true)}
                        disabled={!canManageHotel}
                      />
                      <Label htmlFor={`weekend-day-${day}`} className="font-normal">
                        {label}曜日
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* データ取込状況（自動連携の監視 — F-ING-01） */}
      <DataIngestPanel />

      {/* 料金ランク設定 */}
      <Card>
        <CardHeader>
          <CardTitle>料金ランク設定</CardTitle>
          <CardDescription>
            販売料金表と同じ「部屋タイプ × レート区分 × ランクコード（65〜0＋★1〜★5）」で表示します。価格は100円単位
            {!canManageHotel && "（編集にはMANAGER以上の権限が必要です）"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4 mb-4">
            <div className="flex items-center gap-2">
              <Label htmlFor="rank-room-type" className="text-xs whitespace-nowrap">部屋タイプ</Label>
              <Select value={rankRoomTypeId} onValueChange={setRankRoomTypeId}>
                <SelectTrigger id="rank-room-type" className="h-8 w-56 text-xs">
                  <SelectValue placeholder="部屋タイプを選択" />
                </SelectTrigger>
                <SelectContent>
                  {roomTypes.map((rt) => (
                    <SelectItem key={rt.id} value={rt.id}>
                      {rt.code}｜{rt.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="rank-rate" className="text-xs whitespace-nowrap">レート区分</Label>
              <Select
                value={rankRateCategory}
                onValueChange={(v) => setRankRateCategory(v as RateCategory)}
              >
                <SelectTrigger id="rank-rate" className="h-8 w-28 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RATE_CATEGORIES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {priceRanks.length > 0 && (
              <p className="text-xs text-muted-foreground">{priceRanks.length}段階</p>
            )}
          </div>

          {priceRanksLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : priceRanksError ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <AlertCircle className="w-6 h-6 text-destructive" />
              <p className="text-sm text-muted-foreground">{priceRanksError}</p>
              <Button variant="outline" size="sm" onClick={loadPriceRanks} className="gap-2">
                <RefreshCw className="w-4 h-4" />
                再試行
              </Button>
            </div>
          ) : priceRanks.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              この部屋タイプ・レート区分の料金ランクが登録されていません。
            </p>
          ) : (
            <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 font-medium">ランクコード</th>
                    <th className="text-right py-2 px-3 font-medium">販売価格（宿泊税別）</th>
                    <th className="text-center py-2 px-3 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {priceRanks.map((rank) => (
                    <tr key={rank.id} className="border-b hover:bg-muted/50">
                      <td className="py-2 px-3 font-medium">{rank.rankCode}</td>
                      <td className="text-right py-2 px-3">¥{rank.price.toLocaleString()}</td>
                      <td className="text-center py-2 px-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!canManageHotel}
                          onClick={() => openEditRank(rank)}
                        >
                          <Edit2 className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 料金ランク編集ダイアログ */}
      <Dialog open={editingRank !== null} onOpenChange={(open) => !open && setEditingRank(null)}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle>料金ランク編集（{editingRank?.rankCode}）</DialogTitle>
            <DialogDescription>販売価格を編集します（100円単位・宿泊税別）</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="edit-rank-price">販売価格</Label>
              <Input
                id="edit-rank-price"
                type="number"
                step={100}
                value={editPrice}
                onChange={(e) => setEditPrice(Number.parseInt(e.target.value) || 0)}
              />
              {editPrice % 100 !== 0 && (
                <p className="text-xs text-[color:var(--negative)]">価格は100円単位で入力してください</p>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="outline" size="sm" onClick={() => setEditingRank(null)}>
              キャンセル
            </Button>
            <Button
              size="sm"
              className="gap-2"
              disabled={savingRank || editPrice % 100 !== 0}
              onClick={handleSaveRank}
            >
              {savingRank ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              保存
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
