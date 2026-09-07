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
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  AlertCircle,
  ArrowRightLeft,
  BarChart3,
  Edit2,
  ExternalLink,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"

import { useAuth } from "@/components/auth-provider"
import {
  api,
  ApiClientError,
  type PriceRank,
  type Hotel,
  type Venue,
  type VenueCategory,
  type CreateVenueInput,
  type UpdateVenueInput,
  type OtbImportResult,
  type CompetitorImportResult,
  type ModelComparison,
  type ForecasterModelName,
} from "@/lib/api"

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"]
const DEFAULT_WEEKEND_DAYS = [5, 6] // 金・土（要件定義書 §4）

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

/** 数値入力欄（緯度・経度）の文字列を number | null に変換する。空文字・数値でない場合は null */
function parseOptionalNumber(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === "") return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

/** 6桁の気象庁コード。空なら null、形式不正なら undefined（保存時にエラー表示） */
function parseJmaCode(raw: string): string | null | undefined {
  const trimmed = raw.trim()
  if (trimmed === "") return null
  return /^\d{6}$/.test(trimmed) ? trimmed : undefined
}

function parseWeekendDays(value: unknown): number[] {
  if (Array.isArray(value)) {
    const days = value.filter((v): v is number => typeof v === "number" && v >= 0 && v <= 6)
    if (days.length > 0) return days
  }
  return DEFAULT_WEEKEND_DAYS
}

// ---- 会場マスタ（外部要因設計 Phase 2） ----

const VENUE_CATEGORY_LABELS: Record<VenueCategory, string> = {
  dome: "ドーム",
  arena: "アリーナ",
  hall: "ホール",
  stadium: "スタジアム",
  exhibition: "展示場",
  other: "その他",
}

function venueCategoryLabel(category: VenueCategory | null): string {
  return category ? VENUE_CATEGORY_LABELS[category] ?? category : "-"
}

function venueImpactBadge(impact: Venue["estimatedImpact"]) {
  switch (impact) {
    case "high":
      return <Badge className="bg-negative text-white text-[10px]">高</Badge>
    case "medium":
      return <Badge className="bg-warning text-white text-[10px]">中</Badge>
    case "low":
      return <Badge className="bg-primary text-white text-[10px]">低</Badge>
    default:
      return <Badge variant="outline" className="text-[10px]">未推定</Badge>
  }
}

interface VenueFormState {
  name: string
  category: VenueCategory | "none"
  address: string
  latitude: string
  longitude: string
  capacity: string
  distanceKm: string
  websiteUrl: string
}

const EMPTY_VENUE_FORM: VenueFormState = {
  name: "",
  category: "none",
  address: "",
  latitude: "",
  longitude: "",
  capacity: "",
  distanceKm: "",
  websiteUrl: "",
}

function venueToForm(v: Venue): VenueFormState {
  return {
    name: v.name,
    category: v.category ?? "none",
    address: v.address ?? "",
    latitude: v.latitude != null ? String(v.latitude) : "",
    longitude: v.longitude != null ? String(v.longitude) : "",
    capacity: v.capacity != null ? String(v.capacity) : "",
    distanceKm: v.distanceKm != null ? String(v.distanceKm) : "",
    websiteUrl: v.websiteUrl ?? "",
  }
}

function VenueMasterCard({ hotelId, canManage }: { hotelId: string | null; canManage: boolean }) {
  const { toast } = useToast()
  const [venues, setVenues] = useState<Venue[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Venue | null>(null)
  const [form, setForm] = useState<VenueFormState>(EMPTY_VENUE_FORM)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Venue | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [extractingId, setExtractingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!hotelId) return
    setLoading(true)
    setError(null)
    try {
      setVenues(await api.venues(hotelId))
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "会場マスタの取得に失敗しました")
    } finally {
      setLoading(false)
    }
  }, [hotelId])

  useEffect(() => {
    load()
  }, [load])

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_VENUE_FORM)
    setDialogOpen(true)
  }

  const openEdit = (venue: Venue) => {
    setEditing(venue)
    setForm(venueToForm(venue))
    setDialogOpen(true)
  }

  const setField = (key: keyof VenueFormState, value: string) => setForm((prev) => ({ ...prev, [key]: value }))

  const handleSave = async () => {
    if (!hotelId) return
    if (!form.name.trim()) {
      toast({ title: "会場名を入力してください", variant: "destructive" })
      return
    }
    const lat = parseOptionalNumber(form.latitude)
    const lng = parseOptionalNumber(form.longitude)
    const capacity = parseOptionalNumber(form.capacity)
    const distanceKm = parseOptionalNumber(form.distanceKm)
    if (
      (form.latitude.trim() !== "" && lat == null) ||
      (form.longitude.trim() !== "" && lng == null) ||
      (form.capacity.trim() !== "" && capacity == null) ||
      (form.distanceKm.trim() !== "" && distanceKm == null)
    ) {
      toast({ title: "緯度・経度・収容人数・距離は数値で入力してください（空欄可）", variant: "destructive" })
      return
    }
    if (capacity != null && (capacity < 0 || !Number.isInteger(capacity))) {
      toast({ title: "収容人数は0以上の整数で入力してください", variant: "destructive" })
      return
    }
    if (distanceKm != null && distanceKm < 0) {
      toast({ title: "距離は0以上で入力してください", variant: "destructive" })
      return
    }
    const websiteUrl = form.websiteUrl.trim()
    if (websiteUrl !== "" && !/^https?:\/\//.test(websiteUrl)) {
      toast({ title: "公式ページURLは http(s):// から始めてください", variant: "destructive" })
      return
    }
    const data: UpdateVenueInput = {
      name: form.name.trim(),
      category: form.category === "none" ? null : form.category,
      address: form.address.trim() || null,
      latitude: lat,
      longitude: lng,
      capacity,
      distanceKm,
      websiteUrl: websiteUrl || null,
    }
    setSaving(true)
    try {
      if (editing) {
        await api.updateVenue(editing.id, hotelId, data)
        toast({ title: "会場を更新しました" })
      } else {
        const payload: CreateVenueInput = { hotelId, ...data, name: data.name! }
        await api.createVenue(payload)
        toast({ title: "会場を登録しました" })
      }
      setDialogOpen(false)
      await load()
    } catch (err) {
      toast({
        title: editing ? "会場の更新に失敗しました" : "会場の登録に失敗しました",
        description: err instanceof ApiClientError ? err.message : undefined,
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!hotelId || !deleteTarget) return
    setDeleting(true)
    try {
      await api.deleteVenue(deleteTarget.id, hotelId)
      toast({ title: `「${deleteTarget.name}」を削除しました` })
      setDeleteTarget(null)
      await load()
    } catch (err) {
      toast({
        title: "会場の削除に失敗しました",
        description: err instanceof ApiClientError ? err.message : undefined,
        variant: "destructive",
      })
    } finally {
      setDeleting(false)
    }
  }

  const handleExtract = async (venue: Venue) => {
    if (!hotelId) return
    setExtractingId(venue.id)
    try {
      const result = await api.extractVenueEvents(venue.id, hotelId)
      const summary = `抽出 ${result.extracted} 件 / 候補として登録 ${result.created} 件 / 重複スキップ ${result.skippedDuplicates} 件${result.truncated ? "（ページが長いため一部のみ解析）" : ""}`
      toast({
        title: `${result.venueName} のイベントを抽出しました`,
        description: result.notes ? `${summary}\n${result.notes}` : summary,
      })
    } catch (err) {
      // APIキー未設定・URL未登録時はバックエンドの日本語メッセージをそのまま表示する
      toast({
        title: "イベントの抽出に失敗しました",
        description: err instanceof ApiClientError ? err.message : undefined,
        variant: "destructive",
      })
    } finally {
      setExtractingId(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle>会場マスタ</CardTitle>
            <CardDescription className="mt-1.5">
              近隣のイベント会場を登録すると、イベント登録時の影響度推定と公式ページからのイベント抽出に使われます
              {!canManage && "（編集にはMANAGER以上の権限が必要です）"}
            </CardDescription>
          </div>
          {canManage && (
            <Button variant="outline" size="sm" className="gap-2" onClick={openCreate}>
              <Plus className="w-4 h-4" />
              会場を追加
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : error ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <AlertCircle className="w-6 h-6 text-destructive" />
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" onClick={load} className="gap-2">
              <RefreshCw className="w-4 h-4" />
              再試行
            </Button>
          </div>
        ) : venues.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">会場が登録されていません。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-3 font-medium">会場名</th>
                  <th className="text-left py-2 px-3 font-medium">種別</th>
                  <th className="text-right py-2 px-3 font-medium">収容人数</th>
                  <th className="text-right py-2 px-3 font-medium">距離</th>
                  <th className="text-center py-2 px-3 font-medium">影響度</th>
                  <th className="text-left py-2 px-3 font-medium">公式ページ</th>
                  <th className="text-center py-2 px-3 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {venues.map((v) => (
                  <tr key={v.id} className={`border-b hover:bg-muted/50 ${v.isActive ? "" : "opacity-60"}`}>
                    <td className="py-2 px-3 font-medium">
                      {v.name}
                      {!v.isActive && <span className="ml-1 text-xs text-muted-foreground">（無効）</span>}
                      {v.address && <div className="text-xs text-muted-foreground font-normal">{v.address}</div>}
                    </td>
                    <td className="py-2 px-3">{venueCategoryLabel(v.category)}</td>
                    <td className="text-right py-2 px-3 tabular-nums">{v.capacity != null ? `${v.capacity.toLocaleString()}人` : "-"}</td>
                    <td className="text-right py-2 px-3 tabular-nums">{v.distanceKm != null ? `${v.distanceKm}km` : "-"}</td>
                    <td className="text-center py-2 px-3">{venueImpactBadge(v.estimatedImpact)}</td>
                    <td className="py-2 px-3">
                      {v.websiteUrl ? (
                        <a
                          href={v.websiteUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline max-w-[200px] truncate"
                          title={v.websiteUrl}
                        >
                          <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{v.websiteUrl.replace(/^https?:\/\//, "")}</span>
                        </a>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="text-center py-2 px-3">
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs gap-1"
                          disabled={!canManage || extractingId != null || !v.websiteUrl}
                          title={!v.websiteUrl ? "公式ページURLを登録すると抽出できます" : undefined}
                          onClick={() => handleExtract(v)}
                        >
                          {extractingId === v.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                          イベントを抽出
                        </Button>
                        <Button variant="ghost" size="sm" disabled={!canManage} onClick={() => openEdit(v)}>
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="sm" disabled={!canManage} onClick={() => setDeleteTarget(v)}>
                          <Trash2 className="w-4 h-4 text-muted-foreground" />
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

      {/* 会場の追加・編集ダイアログ */}
      <Dialog open={dialogOpen} onOpenChange={(open) => !saving && setDialogOpen(open)}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{editing ? "会場を編集" : "会場を追加"}</DialogTitle>
            <DialogDescription>収容人数と距離から影響度を推定します。公式ページURLを登録するとイベントを抽出できます</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="venue-name">会場名</Label>
                <Input id="venue-name" value={form.name} onChange={(e) => setField("name", e.target.value)} placeholder="例：○○ドーム" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="venue-category">種別</Label>
                <Select value={form.category} onValueChange={(v: VenueCategory | "none") => setField("category", v)}>
                  <SelectTrigger id="venue-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">未設定</SelectItem>
                    {(Object.keys(VENUE_CATEGORY_LABELS) as VenueCategory[]).map((key) => (
                      <SelectItem key={key} value={key}>
                        {VENUE_CATEGORY_LABELS[key]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="venue-capacity">収容人数</Label>
                <Input
                  id="venue-capacity"
                  type="number"
                  min={0}
                  step={1}
                  value={form.capacity}
                  onChange={(e) => setField("capacity", e.target.value)}
                  placeholder="55000"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="venue-address">住所</Label>
                <Input id="venue-address" value={form.address} onChange={(e) => setField("address", e.target.value)} placeholder="住所を入力" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="venue-latitude">緯度</Label>
                <Input
                  id="venue-latitude"
                  type="number"
                  step="any"
                  min={-90}
                  max={90}
                  value={form.latitude}
                  onChange={(e) => setField("latitude", e.target.value)}
                  placeholder="35.7056"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="venue-longitude">経度</Label>
                <Input
                  id="venue-longitude"
                  type="number"
                  step="any"
                  min={-180}
                  max={180}
                  value={form.longitude}
                  onChange={(e) => setField("longitude", e.target.value)}
                  placeholder="139.7519"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="venue-distance">ホテルからの距離（km）</Label>
                <Input
                  id="venue-distance"
                  type="number"
                  step="0.1"
                  min={0}
                  value={form.distanceKm}
                  onChange={(e) => setField("distanceKm", e.target.value)}
                  placeholder="1.2"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="venue-website">公式ページURL（イベント一覧）</Label>
                <Input
                  id="venue-website"
                  type="url"
                  value={form.websiteUrl}
                  onChange={(e) => setField("websiteUrl", e.target.value)}
                  placeholder="https://example.com/events"
                />
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)} disabled={saving}>
              キャンセル
            </Button>
            <Button size="sm" className="gap-2" disabled={saving} onClick={handleSave}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {editing ? "保存" : "登録"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 削除確認 */}
      <AlertDialog open={deleteTarget != null} onOpenChange={(open) => !open && !deleting && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>会場を削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              「{deleteTarget?.name}」を削除します。この会場に紐づくイベントの会場情報は解除されます。この操作は元に戻せません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault()
                handleDelete()
              }}
            >
              {deleting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              削除する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

// ---- データ取り込み（PMS OTB / 競合価格 — コネクタ設定までの手動経路） ----

const OTB_CSV_PLACEHOLDER = `stayDate,roomsBooked,daysBefore
2026-10-01,84,30
2026-10-02,91,29`

const COMPETITOR_CSV_PLACEHOLDER = `competitorName,date,price1P,price2P,price3P,soldOut
コンペティターホテルA,2026-10-01,15800,21000,27000,false
コンペティターホテルB,2026-10-01,,19800,,満室`

function DataImportCard({ hotelId, canManage }: { hotelId: string | null; canManage: boolean }) {
  const { toast } = useToast()
  const [otbCsv, setOtbCsv] = useState("")
  const [otbImporting, setOtbImporting] = useState(false)
  const [otbResult, setOtbResult] = useState<OtbImportResult | null>(null)
  const [compCsv, setCompCsv] = useState("")
  const [compImporting, setCompImporting] = useState(false)
  const [compResult, setCompResult] = useState<CompetitorImportResult | null>(null)

  const handleImportOtb = async () => {
    if (!hotelId) return
    if (!otbCsv.trim()) {
      toast({ title: "CSVを貼り付けてください", variant: "destructive" })
      return
    }
    setOtbImporting(true)
    setOtbResult(null)
    try {
      const result = await api.importOtb(hotelId, { csv: otbCsv })
      setOtbResult(result)
      toast({
        title: `OTBを ${result.imported} 件取り込みました`,
        description: result.skipped.length > 0 ? `${result.skipped.length} 行をスキップしました` : undefined,
      })
    } catch (err) {
      toast({
        title: "OTBの取り込みに失敗しました",
        description: err instanceof ApiClientError ? err.message : undefined,
        variant: "destructive",
      })
    } finally {
      setOtbImporting(false)
    }
  }

  const handleImportCompetitor = async () => {
    if (!hotelId) return
    if (!compCsv.trim()) {
      toast({ title: "CSVを貼り付けてください", variant: "destructive" })
      return
    }
    setCompImporting(true)
    setCompResult(null)
    try {
      const result = await api.importCompetitorPrices(hotelId, { csv: compCsv })
      setCompResult(result)
      toast({
        title: `競合価格を ${result.imported} 件取り込みました`,
        description:
          [
            result.createdCompetitors.length > 0 ? `新規競合 ${result.createdCompetitors.length} 件` : null,
            result.skipped.length > 0 ? `${result.skipped.length} 行をスキップ` : null,
          ]
            .filter(Boolean)
            .join(" / ") || undefined,
      })
    } catch (err) {
      toast({
        title: "競合価格の取り込みに失敗しました",
        description: err instanceof ApiClientError ? err.message : undefined,
        variant: "destructive",
      })
    } finally {
      setCompImporting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>データ取り込み（PMS / 競合価格）</CardTitle>
        <CardDescription>
          PMS/OTAコネクタが設定されるまでの手動経路です。CSVを貼り付けて取り込むと、予約カーブ（OTB）と競合価格が需要予測に反映されます
          {!canManage && "（取り込みにはMANAGER以上の権限が必要です）"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* PMS OTB */}
        <div className="space-y-3">
          <div>
            <Label htmlFor="otb-csv">PMS 予約状況（OTB）</Label>
            <p className="text-sm text-muted-foreground">
              ヘッダー <code className="text-xs">stayDate,roomsBooked[,daysBefore]</code>。daysBefore を省略すると取り込み日からの日数で記録します
            </p>
          </div>
          <Textarea
            id="otb-csv"
            value={otbCsv}
            onChange={(e) => setOtbCsv(e.target.value)}
            placeholder={OTB_CSV_PLACEHOLDER}
            rows={5}
            className="font-mono text-xs"
            disabled={!canManage}
          />
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm text-muted-foreground">
              {otbResult ? (
                <div className="space-y-1">
                  <p>
                    取り込み <span className="font-semibold text-foreground">{otbResult.imported}</span> 件 ・ スキップ{" "}
                    <span className={`font-semibold ${otbResult.skipped.length > 0 ? "text-warning" : "text-foreground"}`}>{otbResult.skipped.length}</span> 件
                    <span className="ml-1 text-xs">（取込時刻 {new Date(otbResult.capturedAt).toLocaleString("ja-JP")}）</span>
                  </p>
                  {otbResult.skipped.length > 0 && (
                    <ul className="text-xs space-y-0.5 max-h-24 overflow-y-auto">
                      {otbResult.skipped.map((s, i) => (
                        <li key={`${s.stayDate}-${i}`}>
                          {s.stayDate || "（日付なし）"}: {s.reason}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </div>
            <Button size="sm" className="gap-2" disabled={!canManage || otbImporting} onClick={handleImportOtb}>
              {otbImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              取り込む
            </Button>
          </div>
        </div>

        <Separator />

        {/* 競合価格 */}
        <div className="space-y-3">
          <div>
            <Label htmlFor="competitor-csv">競合価格</Label>
            <p className="text-sm text-muted-foreground">
              ヘッダー <code className="text-xs">competitorName,date,price1P,price2P,price3P,soldOut</code>。未登録の競合名は自動で作成されます。soldOut は{" "}
              <code className="text-xs">true</code> / <code className="text-xs">1</code> / <code className="text-xs">満室</code> を受け付けます
            </p>
          </div>
          <Textarea
            id="competitor-csv"
            value={compCsv}
            onChange={(e) => setCompCsv(e.target.value)}
            placeholder={COMPETITOR_CSV_PLACEHOLDER}
            rows={5}
            className="font-mono text-xs"
            disabled={!canManage}
          />
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm text-muted-foreground">
              {compResult ? (
                <div className="space-y-1">
                  <p>
                    取り込み <span className="font-semibold text-foreground">{compResult.imported}</span> 件 ・ スキップ{" "}
                    <span className={`font-semibold ${compResult.skipped.length > 0 ? "text-warning" : "text-foreground"}`}>{compResult.skipped.length}</span> 件
                  </p>
                  {compResult.createdCompetitors.length > 0 && (
                    <p className="text-xs">新規に作成した競合: {compResult.createdCompetitors.join("、")}</p>
                  )}
                  {compResult.skipped.length > 0 && (
                    <ul className="text-xs space-y-0.5 max-h-24 overflow-y-auto">
                      {compResult.skipped.map((s, i) => (
                        <li key={`${s.row}-${i}`}>
                          {s.row} 行目: {s.reason}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </div>
            <Button size="sm" className="gap-2" disabled={!canManage || compImporting} onClick={handleImportCompetitor}>
              {compImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              取り込む
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ---- 予測モデル（バックテスト比較・学習・切り替え） ----

const MODEL_LABELS: Record<string, string> = {
  "rule-based-v2": "ルールベース v2",
  "ridge-v1": "学習モデル（Ridge回帰）v1",
}

function modelLabel(name: string): string {
  return MODEL_LABELS[name] ?? name
}

function ForecastModelCard({
  hotelId,
  canManage,
  isAdmin,
}: {
  hotelId: string | null
  canManage: boolean
  isAdmin: boolean
}) {
  const { toast } = useToast()
  const [comparison, setComparison] = useState<ModelComparison | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [training, setTraining] = useState(false)
  const [promoting, setPromoting] = useState<string | null>(null)
  const [force, setForce] = useState(false)

  // バックテストは数秒かかるためタブ表示時には読まず、ボタン押下時のみ取得する
  const compare = useCallback(async () => {
    if (!hotelId) return
    setLoading(true)
    setError(null)
    try {
      setComparison(await api.compareModels(hotelId))
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "モデル比較の取得に失敗しました")
    } finally {
      setLoading(false)
    }
  }, [hotelId])

  const handleTrain = async () => {
    if (!hotelId) return
    setTraining(true)
    try {
      const result = await api.trainModel(hotelId, "ridge-v1")
      toast({
        title: `${modelLabel(result.modelName)} を学習しました`,
        description: `学習サンプル ${result.samples} 件（${new Date(result.trainedAt).toLocaleString("ja-JP")}）`,
      })
      if (comparison) await compare()
    } catch (err) {
      toast({
        title: "モデルの学習に失敗しました",
        description: err instanceof ApiClientError ? err.message : undefined,
        variant: "destructive",
      })
    } finally {
      setTraining(false)
    }
  }

  const handlePromote = async (modelName: ForecasterModelName) => {
    if (!hotelId) return
    setPromoting(modelName)
    try {
      const result = await api.promoteModel(hotelId, modelName, force || undefined)
      toast({
        title: `稼働モデルを ${modelLabel(result.after)} に切り替えました`,
        description: `${modelLabel(result.before)} → ${modelLabel(result.after)}${force ? "（強制）" : ""}`,
      })
      setForce(false)
      await compare()
    } catch (err) {
      // ゲート不通過時はバックエンドの日本語メッセージをそのまま表示する
      toast({
        title: "モデルの切り替えに失敗しました",
        description: err instanceof ApiClientError ? err.message : undefined,
        variant: "destructive",
      })
    } finally {
      setPromoting(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle>予測モデル</CardTitle>
            <CardDescription className="mt-1.5">
              需要予測に使うモデルをバックテスト（過去実績との照合）で比較し、ゲートを通過したモデルに切り替えます。
              学習は MANAGER 以上、切り替えは ADMIN のみ実行できます
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {canManage && (
              <Button variant="outline" size="sm" className="gap-2" disabled={training} onClick={handleTrain}>
                {training ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                ridge-v1 を学習
              </Button>
            )}
            <Button size="sm" className="gap-2" disabled={loading || !hotelId} onClick={compare}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <BarChart3 className="w-4 h-4" />}
              モデルを比較する
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2 text-sm flex-wrap">
          <span className="text-muted-foreground">稼働中のモデル:</span>
          {comparison ? (
            <Badge>{modelLabel(comparison.activeForecaster)}</Badge>
          ) : (
            <span className="text-muted-foreground text-xs">「モデルを比較する」を押すと表示されます</span>
          )}
          {comparison && comparison.states.length > 0 && (
            <span className="text-xs text-muted-foreground">
              学習済み:{" "}
              {comparison.states
                .map((s) => `${modelLabel(s.modelName)}（${s.samples}件・${new Date(s.trainedAt).toLocaleDateString("ja-JP")}）`)
                .join("、")}
            </span>
          )}
        </div>

        {loading ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">バックテストを実行しています（数秒かかります）...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <AlertCircle className="w-6 h-6 text-destructive" />
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" onClick={compare} className="gap-2">
              <RefreshCw className="w-4 h-4" />
              再試行
            </Button>
          </div>
        ) : !comparison ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            バックテストは数秒かかるため、必要なときに「モデルを比較する」を押して取得してください。
          </p>
        ) : comparison.results.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">比較できる実績データがありません。</p>
        ) : (
          <div className="space-y-4">
            {isAdmin && (
              <div className="flex items-center gap-2">
                <Checkbox id="model-force" checked={force} onCheckedChange={(checked) => setForce(checked === true)} />
                <Label htmlFor="model-force" className="font-normal text-sm">
                  強制（ゲートを通過していなくても切り替える）
                </Label>
              </div>
            )}
            {comparison.results.map((r) => {
              const gate = comparison.promotable[r.modelVersion]
              const isActive = r.modelVersion === comparison.activeForecaster
              const canPromote = isAdmin && !isActive && (gate?.ok || force)
              return (
                <div key={r.modelVersion} className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{modelLabel(r.modelVersion)}</span>
                      <span className="text-xs text-muted-foreground font-mono">{r.modelVersion}</span>
                      {isActive && <Badge>稼働中</Badge>}
                      {r.beatsBaseline ? (
                        <Badge className="bg-primary text-white text-[10px]">ベースラインを上回る</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px]">ベースライン未達</Badge>
                      )}
                    </div>
                    {isAdmin && !isActive && (
                      <Button
                        size="sm"
                        variant={gate?.ok ? "default" : "outline"}
                        className="gap-2"
                        disabled={!canPromote || promoting != null}
                        onClick={() => handlePromote(r.modelVersion as ForecasterModelName)}
                      >
                        {promoting === r.modelVersion ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRightLeft className="w-4 h-4" />}
                        このモデルに切り替え
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    期間 {r.startDate} 〜 {r.endDate} ・ サンプル {r.samples} 件 ・ リードタイム {r.leadDays.join("/")} 日
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-1.5 px-2 font-medium">区間</th>
                          <th className="text-right py-1.5 px-2 font-medium">サンプル</th>
                          <th className="text-right py-1.5 px-2 font-medium">MAPE</th>
                          <th className="text-right py-1.5 px-2 font-medium">ベースラインMAPE</th>
                          <th className="text-right py-1.5 px-2 font-medium">バイアス</th>
                          <th className="text-center py-1.5 px-2 font-medium">判定</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.summary.map((s) => {
                          const better = s.baselineMape != null ? s.mape < s.baselineMape : null
                          return (
                            <tr key={s.bucket} className="border-b last:border-b-0">
                              <td className="py-1.5 px-2">{s.bucket}</td>
                              <td className="text-right py-1.5 px-2 tabular-nums">{s.samples}</td>
                              <td className="text-right py-1.5 px-2 tabular-nums font-medium">{s.mape.toFixed(1)}%</td>
                              <td className="text-right py-1.5 px-2 tabular-nums text-muted-foreground">
                                {s.baselineMape != null ? `${s.baselineMape.toFixed(1)}%` : "-"}
                              </td>
                              <td className="text-right py-1.5 px-2 tabular-nums text-muted-foreground">
                                {s.bias >= 0 ? "+" : ""}
                                {s.bias.toFixed(1)}pt
                              </td>
                              <td className="text-center py-1.5 px-2">
                                {better == null ? (
                                  <span className="text-xs text-muted-foreground">基準</span>
                                ) : better ? (
                                  <span className="text-xs text-[color:var(--positive)]">改善</span>
                                ) : (
                                  <span className="text-xs text-[color:var(--negative)]">悪化</span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  {gate && (
                    <p className={`text-xs ${gate.ok ? "text-muted-foreground" : "text-warning"}`}>
                      {gate.ok ? "切り替え可" : "切り替え不可"}: {gate.reason}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function SettingsTab() {
  const { toast } = useToast()
  const { hotelId, user } = useAuth()
  const canManageHotel = user?.role === "ADMIN" || user?.role === "MANAGER"
  const isAdmin = user?.role === "ADMIN"

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
  // 外部要因（天候予報）取得用の設定。空欄は null として保存する
  const [jmaOfficeCode, setJmaOfficeCode] = useState("")
  const [jmaAreaCode, setJmaAreaCode] = useState("")
  const [latitude, setLatitude] = useState("")
  const [longitude, setLongitude] = useState("")

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
      setJmaOfficeCode(found.jmaOfficeCode ?? "")
      setJmaAreaCode(found.jmaAreaCode ?? "")
      setLatitude(found.latitude != null ? String(found.latitude) : "")
      setLongitude(found.longitude != null ? String(found.longitude) : "")
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
    toast({
      title: "KPI表示項目を保存しました",
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
      const officeCode = parseJmaCode(jmaOfficeCode)
      const areaCode = parseJmaCode(jmaAreaCode)
      if (officeCode === undefined || areaCode === undefined) {
        toast({
          title: "気象庁コードの形式が正しくありません",
          description: "府県予報区コード・一次細分区域コードは6桁の数字で入力してください。",
          variant: "destructive",
        })
        return
      }
      const lat = parseOptionalNumber(latitude)
      const lng = parseOptionalNumber(longitude)
      if ((latitude.trim() !== "" && lat == null) || (longitude.trim() !== "" && lng == null)) {
        toast({
          title: "緯度・経度の形式が正しくありません",
          description: "緯度・経度は数値で入力してください（空欄可）。",
          variant: "destructive",
        })
        return
      }
      setSavingHotel(true)
      try {
        const updated = await api.updateHotelSettings(hotelId, {
          name: hotelName,
          address: hotelAddress,
          phone: contactPhone,
          email: contactEmail,
          totalRooms,
          weekendDays,
          jmaOfficeCode: officeCode,
          jmaAreaCode: areaCode,
          latitude: lat,
          longitude: lng,
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
      setJmaOfficeCode(hotel.jmaOfficeCode ?? "")
      setJmaAreaCode(hotel.jmaAreaCode ?? "")
      setLatitude(hotel.latitude != null ? String(hotel.latitude) : "")
      setLongitude(hotel.longitude != null ? String(hotel.longitude) : "")
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

    toast({
      title: "設定をリセットしました",
      description: "すべての設定がデフォルト値に戻りました。",
    })
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-medium tracking-tight">設定</h1>
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

              <Separator />

              {/* 外部要因（天候予報）の取得設定 — 外部要因設計 P1-7 */}
              <div className="space-y-3">
                <div>
                  <Label>天候予報の取得設定</Label>
                  <p className="text-sm text-muted-foreground">
                    気象庁の週間予報（7日先まで）と Open-Meteo（8〜16日先）を需要予測の要因として取り込むための設定です。
                    コードは気象庁 area.json（https://www.jma.go.jp/bosai/common/const/area.json）の offices / class10s を参照。例: 東京都=130000 / 東京地方=130010
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="jmaOfficeCode">気象庁 府県予報区コード</Label>
                    <Input
                      id="jmaOfficeCode"
                      value={jmaOfficeCode}
                      onChange={(e) => setJmaOfficeCode(e.target.value)}
                      placeholder="130000"
                      inputMode="numeric"
                      maxLength={6}
                      disabled={!canManageHotel}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="jmaAreaCode">一次細分区域コード</Label>
                    <Input
                      id="jmaAreaCode"
                      value={jmaAreaCode}
                      onChange={(e) => setJmaAreaCode(e.target.value)}
                      placeholder="130010"
                      inputMode="numeric"
                      maxLength={6}
                      disabled={!canManageHotel}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="latitude">緯度</Label>
                    <Input
                      id="latitude"
                      type="number"
                      step="any"
                      min={-90}
                      max={90}
                      value={latitude}
                      onChange={(e) => setLatitude(e.target.value)}
                      placeholder="35.6812"
                      disabled={!canManageHotel}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="longitude">経度</Label>
                    <Input
                      id="longitude"
                      type="number"
                      step="any"
                      min={-180}
                      max={180}
                      value={longitude}
                      onChange={(e) => setLongitude(e.target.value)}
                      placeholder="139.7671"
                      disabled={!canManageHotel}
                    />
                  </div>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* 料金ランク設定 */}
      <Card>
        <CardHeader>
          <CardTitle>料金ランク設定</CardTitle>
          <CardDescription>
            最大40段階の料金ランクを表示します
            {!canManageHotel && "（編集にはMANAGER以上の権限が必要です）"}
          </CardDescription>
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

      {/* 会場マスタ（外部要因設計 Phase 2） */}
      <VenueMasterCard hotelId={hotelId} canManage={canManageHotel} />

      {/* データ取り込み（PMS OTB / 競合価格 — コネクタ設定までの手動経路） */}
      <DataImportCard hotelId={hotelId} canManage={canManageHotel} />

      {/* 予測モデル（バックテスト比較・学習・切り替え） */}
      <ForecastModelCard hotelId={hotelId} canManage={canManageHotel} isAdmin={isAdmin} />

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
