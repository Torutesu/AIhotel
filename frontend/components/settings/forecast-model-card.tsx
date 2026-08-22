"use client"

// 予測モデル設定カード（設定タブ）
// AI需要予測（ルールベース）のパラメータをホテル×年で調整する。
// 年=0 はホテルのデフォルト設定（全年共通）。対象年の設定がなければ
// デフォルト設定 → 組み込み値の順にフォールバックする。

import { useState, useEffect, useCallback, type ChangeEvent } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import { AlertCircle, Brain, Loader2, RefreshCw, Save, Trash2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { api, ApiClientError, type ForecastModelConfig } from "@/lib/api"

// 組み込みデフォルト値（backend/src/services/forecast/ruleBasedForecaster.ts と同じ）
const BUILTIN_DEFAULTS = {
  movingAverageWindowDays: 28,
  movingAverageWeight: 0.7,
  eventImpactHighPt: 0.15,
  eventImpactMediumPt: 0.08,
  eventImpactLowPt: 0.03,
  weekendAdjustmentPt: 0.05,
  fallbackOccupancy: 0.6,
}

const yearLabel = (year: number) => (year === 0 ? "デフォルト（全年共通）" : `${year}年`)

export function ForecastModelCard({ hotelId, canManage }: { hotelId: string | null; canManage: boolean }) {
  const { toast } = useToast()

  const [configs, setConfigs] = useState<ForecastModelConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const currentYear = new Date().getFullYear()
  const [selectedYear, setSelectedYear] = useState(0)
  const [form, setForm] = useState({ ...BUILTIN_DEFAULTS, notes: "" })
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    if (!hotelId) return
    setLoading(true)
    setError(null)
    try {
      setConfigs(await api.forecastModelConfigs(hotelId))
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "予測モデル設定の取得に失敗しました")
    } finally {
      setLoading(false)
    }
  }, [hotelId])

  useEffect(() => {
    load()
  }, [load])

  const selectedConfig = configs.find((c) => c.year === selectedYear) ?? null
  const defaultConfig = configs.find((c) => c.year === 0) ?? null

  // 年の選択が変わったら、その年の設定値（なければデフォルト設定→組み込み値）をフォームへ反映
  useEffect(() => {
    const base = selectedConfig ?? defaultConfig
    setForm({
      movingAverageWindowDays: base?.movingAverageWindowDays ?? BUILTIN_DEFAULTS.movingAverageWindowDays,
      movingAverageWeight: base?.movingAverageWeight ?? BUILTIN_DEFAULTS.movingAverageWeight,
      eventImpactHighPt: base?.eventImpactHighPt ?? BUILTIN_DEFAULTS.eventImpactHighPt,
      eventImpactMediumPt: base?.eventImpactMediumPt ?? BUILTIN_DEFAULTS.eventImpactMediumPt,
      eventImpactLowPt: base?.eventImpactLowPt ?? BUILTIN_DEFAULTS.eventImpactLowPt,
      weekendAdjustmentPt: base?.weekendAdjustmentPt ?? BUILTIN_DEFAULTS.weekendAdjustmentPt,
      fallbackOccupancy: base?.fallbackOccupancy ?? BUILTIN_DEFAULTS.fallbackOccupancy,
      notes: selectedConfig?.notes ?? "",
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedYear, configs])

  const setNumberField = (key: keyof typeof BUILTIN_DEFAULTS) => (e: ChangeEvent<HTMLInputElement>) => {
    const value = Number.parseFloat(e.target.value)
    setForm((prev) => ({ ...prev, [key]: Number.isFinite(value) ? value : 0 }))
  }

  const handleSave = async () => {
    if (!hotelId) return
    setSaving(true)
    try {
      await api.upsertForecastModelConfig({
        hotelId,
        year: selectedYear,
        movingAverageWindowDays: Math.round(form.movingAverageWindowDays),
        movingAverageWeight: form.movingAverageWeight,
        eventImpactHighPt: form.eventImpactHighPt,
        eventImpactMediumPt: form.eventImpactMediumPt,
        eventImpactLowPt: form.eventImpactLowPt,
        weekendAdjustmentPt: form.weekendAdjustmentPt,
        fallbackOccupancy: form.fallbackOccupancy,
        ...(form.notes.trim() && { notes: form.notes.trim() }),
      })
      toast({ title: `予測モデル設定（${yearLabel(selectedYear)}）を保存しました` })
      load()
    } catch (err) {
      toast({
        variant: "destructive",
        title: "保存に失敗しました",
        description: err instanceof ApiClientError ? err.message : undefined,
      })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!hotelId || !selectedConfig) return
    setDeleting(true)
    try {
      await api.deleteForecastModelConfig(selectedConfig.id, hotelId)
      toast({ title: `予測モデル設定（${yearLabel(selectedYear)}）を削除しました` })
      load()
    } catch (err) {
      toast({
        variant: "destructive",
        title: "削除に失敗しました",
        description: err instanceof ApiClientError ? err.message : undefined,
      })
    } finally {
      setDeleting(false)
    }
  }

  // 選択候補: デフォルト + 当年から3年先まで + 既に設定が存在する年
  const yearOptions = Array.from(
    new Set([0, currentYear, currentYear + 1, currentYear + 2, currentYear + 3, ...configs.map((c) => c.year)])
  ).sort((a, b) => a - b)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="w-5 h-5" />
          予測モデル設定
        </CardTitle>
        <CardDescription>
          AI需要予測のパラメータをホテル×年で調整します。年別の設定がない年はデフォルト設定が適用されます
          {!canManage && "（変更にはMANAGER以上の権限が必要です）"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <Skeleton className="h-40 w-full" />
        ) : error ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <AlertCircle className="w-6 h-6 text-destructive" />
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" onClick={load} className="gap-2">
              <RefreshCw className="w-4 h-4" />
              再試行
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-2">
                <Label>対象年</Label>
                <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
                  <SelectTrigger className="w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {yearOptions.map((y) => (
                      <SelectItem key={y} value={String(y)}>
                        {yearLabel(y)}
                        {configs.some((c) => c.year === y) ? "（設定済み）" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-sm text-muted-foreground pb-2">
                {selectedConfig
                  ? "この年の設定が適用されています"
                  : selectedYear === 0
                    ? "未保存の場合は組み込みの標準値が適用されます"
                    : "この年の設定はまだなく、デフォルト設定が適用されています"}
              </p>
            </div>

            <Separator />

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="fm-window">同曜日移動平均の参照日数</Label>
                <Input
                  id="fm-window"
                  type="number"
                  min={7}
                  max={120}
                  value={form.movingAverageWindowDays}
                  onChange={setNumberField("movingAverageWindowDays")}
                  disabled={!canManage}
                />
                <p className="text-xs text-muted-foreground">7〜120日（標準: 28日）</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="fm-weight">直近実績の重み</Label>
                <Input
                  id="fm-weight"
                  type="number"
                  step={0.05}
                  min={0}
                  max={1}
                  value={form.movingAverageWeight}
                  onChange={setNumberField("movingAverageWeight")}
                  disabled={!canManage}
                />
                <p className="text-xs text-muted-foreground">0〜1。残りが前年同時期の重み（標準: 0.7）</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="fm-fallback">基準稼働率（実績なし時）</Label>
                <Input
                  id="fm-fallback"
                  type="number"
                  step={0.05}
                  min={0}
                  max={1}
                  value={form.fallbackOccupancy}
                  onChange={setNumberField("fallbackOccupancy")}
                  disabled={!canManage}
                />
                <p className="text-xs text-muted-foreground">0〜1（標準: 0.6）</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="fm-ev-high">イベント補正: 影響大</Label>
                <Input
                  id="fm-ev-high"
                  type="number"
                  step={0.01}
                  min={0}
                  max={0.5}
                  value={form.eventImpactHighPt}
                  onChange={setNumberField("eventImpactHighPt")}
                  disabled={!canManage}
                />
                <p className="text-xs text-muted-foreground">稼働率への加算幅（標準: 0.15 = +15pt）</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="fm-ev-medium">イベント補正: 影響中</Label>
                <Input
                  id="fm-ev-medium"
                  type="number"
                  step={0.01}
                  min={0}
                  max={0.5}
                  value={form.eventImpactMediumPt}
                  onChange={setNumberField("eventImpactMediumPt")}
                  disabled={!canManage}
                />
                <p className="text-xs text-muted-foreground">標準: 0.08 = +8pt</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="fm-ev-low">イベント補正: 影響小</Label>
                <Input
                  id="fm-ev-low"
                  type="number"
                  step={0.01}
                  min={0}
                  max={0.5}
                  value={form.eventImpactLowPt}
                  onChange={setNumberField("eventImpactLowPt")}
                  disabled={!canManage}
                />
                <p className="text-xs text-muted-foreground">標準: 0.03 = +3pt</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="fm-weekend">週末補正</Label>
                <Input
                  id="fm-weekend"
                  type="number"
                  step={0.01}
                  min={0}
                  max={0.5}
                  value={form.weekendAdjustmentPt}
                  onChange={setNumberField("weekendAdjustmentPt")}
                  disabled={!canManage}
                />
                <p className="text-xs text-muted-foreground">週末定義の曜日への加算幅（標準: 0.05 = +5pt）</p>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="fm-notes">メモ（任意）</Label>
                <Input
                  id="fm-notes"
                  value={form.notes}
                  onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                  placeholder="例: 2027年は近隣に大型MICE施設開業のためイベント補正を強める"
                  disabled={!canManage}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              {selectedConfig && (
                <Button
                  variant="outline"
                  className="gap-2 bg-transparent"
                  onClick={handleDelete}
                  disabled={!canManage || deleting}
                >
                  {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  この設定を削除
                </Button>
              )}
              <Button className="gap-2" onClick={handleSave} disabled={!canManage || saving || !hotelId}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                保存
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
