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
import { AlertCircle, Edit2, Loader2, Plus, RefreshCw, Save, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { ConfirmDialog } from "@/components/confirm-dialog"

import { useAuth } from "@/components/auth-provider"
import { api, ApiClientError, type Hotel, type PriceRank } from "@/lib/api"

/** 料金ランクの上限（F-SET-02。バリデータ・seed と揃える） */
const MAX_PRICE_RANKS = 40
import { DAY_NAMES as WEEKDAY_LABELS, DEFAULT_WEEKEND_DAYS, parseWeekendDays } from "@/lib/date"

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
  const { hotelId, user, setHotel: setAuthHotel } = useAuth()
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
  const [priceRanks, setPriceRanks] = useState<PriceRank[]>([])
  const [priceRanksLoading, setPriceRanksLoading] = useState(true)
  const [priceRanksError, setPriceRanksError] = useState<string | null>(null)
  const [editingRank, setEditingRank] = useState<PriceRank | null>(null)
  const [editLabel, setEditLabel] = useState("")
  const [editPrice1P, setEditPrice1P] = useState(0)
  const [editPrice2P, setEditPrice2P] = useState(0)
  const [editPrice3P, setEditPrice3P] = useState(0)
  const [editPrice4P, setEditPrice4P] = useState(0)
  const [savingRank, setSavingRank] = useState(false)

  const loadPriceRanks = useCallback(async () => {
    if (!hotelId) return
    setPriceRanksLoading(true)
    setPriceRanksError(null)
    try {
      const result = await api.priceRanks(hotelId)
      setPriceRanks(result)
    } catch (err) {
      setPriceRanksError(err instanceof ApiClientError ? err.message : "料金ランクの取得に失敗しました")
    } finally {
      setPriceRanksLoading(false)
    }
  }, [hotelId])

  useEffect(() => {
    loadPriceRanks()
  }, [loadPriceRanks])

  // 料金ランクの追加・削除（U-3 — POST / DELETE /settings/price-ranks）
  const [isAddRankOpen, setIsAddRankOpen] = useState(false)
  const [newRankLabel, setNewRankLabel] = useState("")
  const [newRankPrice1P, setNewRankPrice1P] = useState(0)
  const [newRankPrice2P, setNewRankPrice2P] = useState(0)
  const [newRankPrice3P, setNewRankPrice3P] = useState(0)
  const [newRankPrice4P, setNewRankPrice4P] = useState(0)
  const [creatingRank, setCreatingRank] = useState(false)
  const [rankPendingDelete, setRankPendingDelete] = useState<PriceRank | null>(null)
  const [deletingRankId, setDeletingRankId] = useState<string | null>(null)

  /** 次に採番するランク番号（既存の最大＋1）。40段階を超えたら追加できない */
  const nextRankNumber = priceRanks.reduce((max, r) => Math.max(max, r.rank), 0) + 1
  const canAddRank = canManageHotel && nextRankNumber <= MAX_PRICE_RANKS

  const openAddRank = () => {
    setNewRankLabel(`R${String(nextRankNumber).padStart(2, "0")}`)
    setNewRankPrice1P(0)
    setNewRankPrice2P(0)
    setNewRankPrice3P(0)
    setNewRankPrice4P(0)
    setIsAddRankOpen(true)
  }

  const handleCreateRank = async () => {
    if (!hotelId) return
    if (nextRankNumber > MAX_PRICE_RANKS) {
      toast.error(`料金ランクは最大${MAX_PRICE_RANKS}段階です`)
      return
    }
    setCreatingRank(true)
    try {
      await api.createPriceRank({
        hotelId,
        rank: nextRankNumber,
        label: newRankLabel.trim() || `R${String(nextRankNumber).padStart(2, "0")}`,
        price1P: newRankPrice1P,
        price2P: newRankPrice2P,
        price3P: newRankPrice3P,
        price4P: newRankPrice4P,
      })
      toast.success("料金ランクを追加しました")
      setIsAddRankOpen(false)
      await loadPriceRanks()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "料金ランクの追加に失敗しました")
    } finally {
      setCreatingRank(false)
    }
  }

  const handleDeleteRank = async (rank: PriceRank) => {
    if (!hotelId) return
    setDeletingRankId(rank.id)
    try {
      await api.deletePriceRank(rank.id, hotelId)
      toast.success("料金ランクを削除しました")
      await loadPriceRanks()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "料金ランクの削除に失敗しました")
    } finally {
      setDeletingRankId(null)
    }
  }

  const openEditRank = (rank: PriceRank) => {
    setEditingRank(rank)
    setEditLabel(rank.label)
    setEditPrice1P(rank.price1P)
    setEditPrice2P(rank.price2P)
    setEditPrice3P(rank.price3P ?? 0)
    setEditPrice4P(rank.price4P ?? 0)
  }

  const handleSaveRank = async () => {
    if (!hotelId || !editingRank) return
    setSavingRank(true)
    try {
      await api.updatePriceRank(editingRank.id, hotelId, {
        label: editLabel,
        price1P: editPrice1P,
        price2P: editPrice2P,
        price3P: editPrice3P,
        price4P: editPrice4P,
      })
      toast.success("料金ランクを更新しました")
      setEditingRank(null)
      await loadPriceRanks()
    } catch (err) {
      toast.error(
        err instanceof ApiClientError ? err.message : "料金ランクの更新に失敗しました",
      )
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
        // 週末定義などの施設設定は AuthProvider が全画面へ配っているため、保存後に差し替える（U-6）
        setAuthHotel(updated)
        toast.success("設定を保存しました", { description: "変更が正常に保存されました。" })
      } catch (err) {
        toast.error(
          err instanceof ApiClientError ? err.message : "ホテル設定の保存に失敗しました",
        )
      } finally {
        setSavingHotel(false)
      }
    } else {
      toast.success("設定を保存しました", { description: "変更が正常に保存されました。" })
    }
  }

  // 設定リセットの確認ダイアログ（F-5）
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)

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
    setDashboardKpiItems(ALL_DASHBOARD_KPI_KEYS)

    toast.success("設定をリセットしました", {
      description: "すべての設定がデフォルト値に戻りました。",
    })
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

      {/* 料金ランク設定 */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle>料金ランク設定</CardTitle>
              <CardDescription>
                最大{MAX_PRICE_RANKS}段階の料金ランクを管理します（現在 {priceRanks.length} 段階）
                {!canManageHotel && "（編集にはMANAGER以上の権限が必要です）"}
              </CardDescription>
            </div>
            {canManageHotel && (
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={openAddRank}
                disabled={!canAddRank || priceRanksLoading}
                title={canAddRank ? undefined : `料金ランクは最大${MAX_PRICE_RANKS}段階です`}
              >
                <Plus className="w-4 h-4" aria-hidden />
                ランクを追加
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
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
            <p className="text-sm text-muted-foreground py-8 text-center">料金ランクが登録されていません。</p>
          ) : (
            <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 font-medium">ランク</th>
                    <th className="text-left py-2 px-3 font-medium">ラベル</th>
                    <th className="text-right py-2 px-3 font-medium">1名</th>
                    <th className="text-right py-2 px-3 font-medium">2名</th>
                    <th className="text-right py-2 px-3 font-medium">3名</th>
                    <th className="text-right py-2 px-3 font-medium">4名</th>
                    <th className="text-center py-2 px-3 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {priceRanks.map((rank) => (
                    <tr key={rank.id} className="border-b hover:bg-muted/50">
                      <td className="py-2 px-3">R{String(rank.rank).padStart(2, "0")}</td>
                      <td className="py-2 px-3 font-medium">{rank.label}</td>
                      <td className="text-right py-2 px-3">¥{rank.price1P.toLocaleString()}</td>
                      <td className="text-right py-2 px-3">¥{rank.price2P.toLocaleString()}</td>
                      <td className="text-right py-2 px-3">{rank.price3P != null ? `¥${rank.price3P.toLocaleString()}` : "-"}</td>
                      <td className="text-right py-2 px-3">{rank.price4P != null ? `¥${rank.price4P.toLocaleString()}` : "-"}</td>
                      <td className="text-center py-2 px-3">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={!canManageHotel}
                            onClick={() => openEditRank(rank)}
                            aria-label={`料金ランク ${rank.label} を編集`}
                          >
                            <Edit2 className="w-4 h-4" aria-hidden />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={!canManageHotel || deletingRankId === rank.id}
                            onClick={() => setRankPendingDelete(rank)}
                            aria-label={`料金ランク ${rank.label} を削除`}
                          >
                            {deletingRankId === rank.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                            ) : (
                              <Trash2 className="w-4 h-4 text-muted-foreground" aria-hidden />
                            )}
                          </Button>
                        </div>
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
            <DialogTitle>料金ランク編集（R{editingRank ? String(editingRank.rank).padStart(2, "0") : ""}）</DialogTitle>
            <DialogDescription>ラベルと人数別価格を編集します</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="edit-rank-label">ラベル</Label>
              <Input id="edit-rank-label" value={editLabel} onChange={(e) => setEditLabel(e.target.value)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-rank-1p">1名料金</Label>
                <Input
                  id="edit-rank-1p"
                  type="number"
                  value={editPrice1P}
                  onChange={(e) => setEditPrice1P(Number.parseInt(e.target.value) || 0)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-rank-2p">2名料金</Label>
                <Input
                  id="edit-rank-2p"
                  type="number"
                  value={editPrice2P}
                  onChange={(e) => setEditPrice2P(Number.parseInt(e.target.value) || 0)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-rank-3p">3名料金</Label>
                <Input
                  id="edit-rank-3p"
                  type="number"
                  value={editPrice3P}
                  onChange={(e) => setEditPrice3P(Number.parseInt(e.target.value) || 0)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-rank-4p">4名料金</Label>
                <Input
                  id="edit-rank-4p"
                  type="number"
                  value={editPrice4P}
                  onChange={(e) => setEditPrice4P(Number.parseInt(e.target.value) || 0)}
                />
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="outline" size="sm" onClick={() => setEditingRank(null)}>
              キャンセル
            </Button>
            <Button size="sm" className="gap-2" disabled={savingRank} onClick={handleSaveRank}>
              {savingRank ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              保存
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 料金ランク追加ダイアログ（U-3） */}
      <Dialog open={isAddRankOpen} onOpenChange={setIsAddRankOpen}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle>料金ランク追加（R{String(nextRankNumber).padStart(2, "0")}）</DialogTitle>
            <DialogDescription>
              ランク番号は既存の最大値＋1で自動採番されます（最大{MAX_PRICE_RANKS}段階）
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="new-rank-label">ラベル</Label>
              <Input
                id="new-rank-label"
                value={newRankLabel}
                onChange={(e) => setNewRankLabel(e.target.value)}
                maxLength={10}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="new-rank-1p">1名料金</Label>
                <Input
                  id="new-rank-1p"
                  type="number"
                  min={0}
                  value={newRankPrice1P}
                  onChange={(e) => setNewRankPrice1P(Number.parseInt(e.target.value) || 0)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-rank-2p">2名料金</Label>
                <Input
                  id="new-rank-2p"
                  type="number"
                  min={0}
                  value={newRankPrice2P}
                  onChange={(e) => setNewRankPrice2P(Number.parseInt(e.target.value) || 0)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-rank-3p">3名料金</Label>
                <Input
                  id="new-rank-3p"
                  type="number"
                  min={0}
                  value={newRankPrice3P}
                  onChange={(e) => setNewRankPrice3P(Number.parseInt(e.target.value) || 0)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-rank-4p">4名料金</Label>
                <Input
                  id="new-rank-4p"
                  type="number"
                  min={0}
                  value={newRankPrice4P}
                  onChange={(e) => setNewRankPrice4P(Number.parseInt(e.target.value) || 0)}
                />
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="outline" size="sm" onClick={() => setIsAddRankOpen(false)}>
              キャンセル
            </Button>
            <Button size="sm" className="gap-2" disabled={creatingRank} onClick={handleCreateRank}>
              {creatingRank ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
              ) : (
                <Save className="w-4 h-4" aria-hidden />
              )}
              追加
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 料金ランク削除の確認（F-5 / U-3） */}
      <ConfirmDialog
        open={rankPendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setRankPendingDelete(null)
        }}
        title="料金ランクを削除しますか？"
        description={
          rankPendingDelete
            ? `R${String(rankPendingDelete.rank).padStart(2, "0")}「${rankPendingDelete.label}」を削除します。この操作は取り消せません。`
            : undefined
        }
        confirmLabel="削除する"
        onConfirm={() => {
          const target = rankPendingDelete
          setRankPendingDelete(null)
          if (target) void handleDeleteRank(target)
        }}
      />

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
