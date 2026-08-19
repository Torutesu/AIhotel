"use client"

// 運営担当者の意向と差異、継続学習の操作画面（F-DP-08 / F-DP-09 / F-DP-10）。
//
// 3つの役割を1枚で扱う:
//   1. 意向の記録   … AI推奨に対して実際にいくらで運用したか＋その理由を残す
//   2. 差異の可視化 … AI推奨と実際にやった値、AI予測と実績のズレを日別・理由別に見る
//   3. 継続学習     … 蓄積された意向から学習した補正を確認し、予測に反映するか判断する

import { useState, useEffect, useCallback, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { AlertCircle, RefreshCw, Loader2, Plus, Brain, Info } from "lucide-react"
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { toast } from "sonner"

import { useAuth } from "@/components/auth-provider"
import {
  api,
  ApiClientError,
  type IntentVarianceReport,
  type IntentVarianceDay,
  type OperatorPreferenceProfile,
  type PriceIntentReason,
} from "@/lib/api"

const INTENT_REASON_OPTIONS: Array<{ value: PriceIntentReason; label: string }> = [
  { value: "FOLLOW_AI", label: "AI推奨に従う" },
  { value: "COMPETITOR_MOVE", label: "競合の動きに追随" },
  { value: "EVENT_DEMAND", label: "イベント・地域需要" },
  { value: "GROUP_BLOCK", label: "団体・グループ受入" },
  { value: "OTA_CAMPAIGN", label: "OTAキャンペーン" },
  { value: "BUDGET_PRESSURE", label: "予算達成" },
  { value: "FIELD_INSIGHT", label: "現場の肌感覚" },
  { value: "OPERATION_LIMIT", label: "オペレーション制約" },
  { value: "OTHER", label: "その他" },
]

const INTENT_REASON_LABELS = Object.fromEntries(
  INTENT_REASON_OPTIONS.map((o) => [o.value, o.label])
) as Record<PriceIntentReason, string>

const DECISION_TYPE_STYLE: Record<string, { label: string; className: string }> = {
  ACCEPTED: { label: "AI推奨どおり", className: "bg-slate-100 text-slate-700 border-slate-200" },
  RAISED: { label: "上げた", className: "bg-rose-100 text-rose-700 border-rose-200" },
  LOWERED: { label: "下げた", className: "bg-sky-100 text-sky-700 border-sky-200" },
}

const OUTCOME_STYLE: Record<string, { label: string; className: string }> = {
  OPERATOR_BETTER: { label: "実績がAI想定を上回り", className: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  AI_BETTER: { label: "実績がAI想定を下回り", className: "bg-amber-100 text-amber-700 border-amber-200" },
  EVEN: { label: "ほぼ想定どおり", className: "bg-slate-100 text-slate-600 border-slate-200" },
}

function yen(value: number | null | undefined): string {
  return value == null ? "—" : `¥${Math.round(value).toLocaleString()}`
}

function signedYen(value: number | null | undefined): string {
  if (value == null) return "—"
  const sign = value > 0 ? "+" : value < 0 ? "−" : "±"
  return `${sign}¥${Math.abs(Math.round(value)).toLocaleString()}`
}

function signedRank(value: number | null | undefined): string {
  if (value == null) return "—"
  if (value === 0) return "±0"
  // 平均・中央値は小数になりうるので桁を揃える（ランク自体は整数）
  const abs = Math.abs(value)
  return `${value > 0 ? "+" : "−"}${Number.isInteger(abs) ? abs : abs.toFixed(1)}`
}

function pctOf(value: number | null | undefined, digits = 1): string {
  return value == null ? "—" : `${(value * 100).toFixed(digits)}%`
}

function signedPct(value: number | null | undefined, digits = 1): string {
  if (value == null) return "—"
  const sign = value > 0 ? "+" : value < 0 ? "−" : "±"
  return `${sign}${Math.abs(value * 100).toFixed(digits)}%`
}

function formatDayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00`)
  const names = ["日", "月", "火", "水", "木", "金", "土"]
  return `${d.getMonth() + 1}/${d.getDate()}(${names[d.getDay()]})`
}

interface OperatorIntentPanelProps {
  hotelId: string
  year: number
  month: number
  /** 意向を記録するときの初期選択日（価格カレンダーで選択中の日など） */
  defaultDate?: string
}

export function OperatorIntentPanel({ hotelId, year, month, defaultDate }: OperatorIntentPanelProps) {
  const { user } = useAuth()
  const canManageLearning = user?.role === "ADMIN" || user?.role === "MANAGER"

  const [report, setReport] = useState<IntentVarianceReport | null>(null)
  const [profiles, setProfiles] = useState<OperatorPreferenceProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formDate, setFormDate] = useState(defaultDate ?? "")
  const [formRank, setFormRank] = useState("")
  const [formReason, setFormReason] = useState<PriceIntentReason>("FOLLOW_AI")
  const [formNote, setFormNote] = useState("")

  const [relearning, setRelearning] = useState(false)
  const [togglingProfileId, setTogglingProfileId] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [varianceReport, profileList] = await Promise.all([
        api.intentVariance(hotelId, year, month),
        api.preferenceProfiles(hotelId),
      ])
      setReport(varianceReport)
      setProfiles(profileList)
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : "運営担当者の意向・差異データの取得に失敗しました"
      )
    } finally {
      setLoading(false)
    }
  }, [hotelId, year, month])

  useEffect(() => {
    void loadData()
  }, [loadData])

  // 差異が出ている日（意向が記録され、AI推奨と異なる値で運用した日）を大きい順に
  const divergentDays = useMemo(() => {
    if (!report) return []
    return report.days
      .filter((d) => d.rankDelta != null && d.rankDelta !== 0)
      .sort((a, b) => Math.abs(b.rankDelta ?? 0) - Math.abs(a.rankDelta ?? 0))
  }, [report])

  function openDialog(date?: string) {
    const target = date ?? defaultDate ?? report?.days[0]?.date ?? ""
    setFormDate(target)
    const day = report?.days.find((d) => d.date === target)
    setFormRank(day?.aiRank != null ? String(day.aiRank) : "")
    setFormReason("FOLLOW_AI")
    setFormNote("")
    setIsDialogOpen(true)
  }

  async function handleSubmit() {
    if (!formDate) {
      toast.error("対象日を選択してください")
      return
    }
    const rank = Number(formRank)
    if (!Number.isInteger(rank) || rank < 1 || rank > 40) {
      toast.error("適用した料金ランクを1〜40で入力してください")
      return
    }

    setSaving(true)
    try {
      await api.createPriceDecision({
        hotelId,
        date: formDate,
        appliedRank: rank,
        intentReason: formReason,
        intentNote: formNote.trim() || undefined,
      })
      toast.success("価格判断を記録しました")
      setIsDialogOpen(false)
      await loadData()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "記録に失敗しました")
    } finally {
      setSaving(false)
    }
  }

  async function handleRelearn() {
    setRelearning(true)
    try {
      const result = await api.recomputePreferenceProfiles(hotelId)
      toast.success(
        `意向プロファイルを再学習しました（判断${result.sampleCount}件 / ${result.segmentCount}セグメント）`
      )
      await loadData()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "再学習に失敗しました")
    } finally {
      setRelearning(false)
    }
  }

  async function handleToggleProfile(profile: OperatorPreferenceProfile, next: boolean) {
    setTogglingProfileId(profile.id)
    try {
      const updated = await api.updatePreferenceProfile(profile.id, hotelId, next)
      setProfiles((prev) => prev.map((p) => (p.id === profile.id ? updated : p)))
      toast.success(next ? "この意向補正を需要予測に反映します" : "この意向補正の反映を止めました")
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "切り替えに失敗しました")
    } finally {
      setTogglingProfileId(null)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">運営担当者の意向とAI推奨の差異</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8 flex flex-col items-center gap-3 text-center">
          <AlertCircle className="w-8 h-8 text-destructive" />
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" size="sm" onClick={() => void loadData()} className="gap-2">
            <RefreshCw className="w-4 h-4" />
            再試行
          </Button>
        </CardContent>
      </Card>
    )
  }

  const summary = report?.summary

  return (
    <div className="space-y-4">
      {/* ---- 差異サマリ ---- */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base font-medium">運営担当者の意向とAI推奨の差異</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              AI推奨に対して実際にどう運用したか、その結果どうだったかを記録・比較します
            </p>
          </div>
          <Button size="sm" className="gap-1.5" onClick={() => openDialog()}>
            <Plus className="w-4 h-4" />
            意向を記録
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <SummaryTile label="意向の記録日数" value={`${summary?.decidedDays ?? 0} / ${summary?.totalDays ?? 0}日`} />
            <SummaryTile
              label="AI推奨の追随率"
              value={pctOf(summary?.followRate)}
              hint={`そのまま採用 ${summary?.acceptedCount ?? 0}日 / 上げ ${summary?.raisedCount ?? 0}日 / 下げ ${summary?.loweredCount ?? 0}日`}
            />
            <SummaryTile label="平均ランク乖離" value={signedRank(summary?.avgRankDelta ?? null)} />
            <SummaryTile label="平均価格乖離率" value={signedPct(summary?.avgPriceDeltaPct)} />
            <SummaryTile
              label="実績がAI想定を上回った割合"
              value={pctOf(summary?.outperformRate)}
              hint={`実績が判明した ${summary?.evaluatedCount ?? 0}日が母数。想定RevPAR（予測稼働率×予測ADR）との比較`}
            />
          </div>

          {summary && summary.byIntentReason.length > 0 && (
            <div className="overflow-x-auto">
              <p className="text-xs font-medium mb-1">意向の理由別</p>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-1.5 px-2 font-medium">理由</th>
                    <th className="text-right py-1.5 px-2 font-medium">日数</th>
                    <th className="text-right py-1.5 px-2 font-medium">平均ランク乖離</th>
                    <th className="text-right py-1.5 px-2 font-medium">平均価格乖離率</th>
                    <th className="text-right py-1.5 px-2 font-medium">想定超え率</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byIntentReason.map((row) => (
                    <tr key={row.key} className="border-b last:border-0">
                      <td className="py-1.5 px-2">{row.label}</td>
                      <td className="py-1.5 px-2 text-right">{row.count}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">{signedRank(row.avgRankDelta)}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">{signedPct(row.avgPriceDeltaPct)}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">
                        {row.evaluatedCount > 0 ? `${pctOf(row.outperformRate)}（${row.evaluatedCount}日）` : "評価待ち"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---- 差異が出た日の一覧 ---- */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">AI推奨と実際にやった値の差異（日別）</CardTitle>
        </CardHeader>
        <CardContent>
          {divergentDays.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              この月はAI推奨と異なる価格で運用した日がありません。
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-1.5 px-2 font-medium">日付</th>
                    <th className="text-left py-1.5 px-2 font-medium">需要</th>
                    <th className="text-right py-1.5 px-2 font-medium">AI推奨</th>
                    <th className="text-right py-1.5 px-2 font-medium">実際に適用</th>
                    <th className="text-right py-1.5 px-2 font-medium">差異</th>
                    <th className="text-left py-1.5 px-2 font-medium">意向</th>
                    <th className="text-right py-1.5 px-2 font-medium">実績RevPAR / AI想定</th>
                    <th className="text-left py-1.5 px-2 font-medium">結果</th>
                  </tr>
                </thead>
                <tbody>
                  {divergentDays.map((day) => (
                    <DivergentRow key={day.date} day={day} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---- 継続学習 ---- */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Brain className="w-4 h-4" />
              意向からの継続学習
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              蓄積された判断からセグメント別の癖を学習します。反映するかは人が判断します（自動では反映されません）。
            </p>
          </div>
          {canManageLearning && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => void handleRelearn()}
              disabled={relearning}
            >
              {relearning ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              再学習
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {profiles.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              学習済みのプロファイルがありません。判断を記録してから再学習してください。
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-1.5 px-2 font-medium">セグメント</th>
                    <th className="text-right py-1.5 px-2 font-medium">判断件数</th>
                    <th className="text-right py-1.5 px-2 font-medium">傾向（中央値）</th>
                    <th className="text-right py-1.5 px-2 font-medium">想定超え率</th>
                    <th className="text-left py-1.5 px-2 font-medium">主な理由</th>
                    <th className="text-right py-1.5 px-2 font-medium">予測への補正</th>
                    <th className="text-center py-1.5 px-2 font-medium">反映</th>
                  </tr>
                </thead>
                <tbody>
                  {profiles.map((profile) => (
                    <tr key={profile.id} className="border-b last:border-0">
                      <td className="py-1.5 px-2">
                        {profile.demandLevel ?? "—"} / {profile.dayType === "weekend" ? "週末" : "平日"}
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums">{profile.sampleCount}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">{signedRank(profile.medianRankDelta)}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">
                        {profile.evaluatedCount > 0
                          ? `${pctOf(profile.outperformRate)}（${profile.evaluatedCount}日）`
                          : "評価待ち"}
                      </td>
                      <td className="py-1.5 px-2">
                        {profile.dominantIntentReason ? INTENT_REASON_LABELS[profile.dominantIntentReason] : "—"}
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums">
                        {profile.appliedRankDelta === 0 ? (
                          <TooltipProvider>
                            <UITooltip>
                              <TooltipTrigger className="inline-flex items-center gap-1 text-muted-foreground">
                                補正なし
                                <Info className="w-3 h-3" />
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs text-xs">
                                判断件数が少ないか、意向どおりに動かしても実績が伴っていないため、
                                このセグメントは学習結果を予測に使いません。
                              </TooltipContent>
                            </UITooltip>
                          </TooltipProvider>
                        ) : (
                          <Badge variant="outline">{signedRank(profile.appliedRankDelta)}ランク</Badge>
                        )}
                      </td>
                      <td className="py-1.5 px-2 text-center">
                        <Switch
                          checked={profile.isEnabled}
                          disabled={
                            !canManageLearning ||
                            profile.appliedRankDelta === 0 ||
                            togglingProfileId === profile.id
                          }
                          onCheckedChange={(next) => void handleToggleProfile(profile, next)}
                          aria-label={`${profile.segmentKey} の意向補正を予測に反映`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!canManageLearning && (
                <p className="text-[11px] text-muted-foreground mt-2">
                  予測への反映の切り替えはMANAGER以上の権限が必要です。
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---- 意向の記録ダイアログ ---- */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>価格判断（意向）を記録</DialogTitle>
            <DialogDescription>
              実際に適用した料金ランクと、その判断理由を残します。AI推奨との差は自動で算出されます。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="intent-date" className="text-xs">対象日</Label>
              <Input
                id="intent-date"
                type="date"
                value={formDate}
                onChange={(e) => {
                  setFormDate(e.target.value)
                  const day = report?.days.find((d) => d.date === e.target.value)
                  if (day?.aiRank != null) setFormRank(String(day.aiRank))
                }}
              />
              <p className="text-[11px] text-muted-foreground">
                {(() => {
                  const day = report?.days.find((d) => d.date === formDate)
                  if (!day) return "この月の日付を選ぶとAI推奨が表示されます"
                  return `AI推奨: ランク${day.aiRank ?? "—"}（${yen(day.aiPrice)}） / 需要レベル ${day.demandLevel ?? "—"}`
                })()}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="intent-rank" className="text-xs">実際に適用した料金ランク（1〜40）</Label>
              <Input
                id="intent-rank"
                type="number"
                min={1}
                max={40}
                value={formRank}
                onChange={(e) => setFormRank(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">意向（判断理由）</Label>
              <Select value={formReason} onValueChange={(v) => setFormReason(v as PriceIntentReason)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INTENT_REASON_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="intent-note" className="text-xs">補足メモ（任意）</Label>
              <Textarea
                id="intent-note"
                value={formNote}
                onChange={(e) => setFormNote(e.target.value)}
                placeholder="例: 近隣2館が同水準まで下げてきたため追随"
                rows={3}
                maxLength={1000}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setIsDialogOpen(false)} disabled={saving}>
              キャンセル
            </Button>
            <Button size="sm" className="gap-1.5" onClick={() => void handleSubmit()} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              記録する
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SummaryTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border p-2">
      <p className="text-[11px] text-muted-foreground flex items-center gap-1">
        {label}
        {hint && (
          <TooltipProvider>
            <UITooltip>
              <TooltipTrigger>
                <Info className="w-3 h-3" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">{hint}</TooltipContent>
            </UITooltip>
          </TooltipProvider>
        )}
      </p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  )
}

function DivergentRow({ day }: { day: IntentVarianceDay }) {
  const decisionStyle = day.decisionType ? DECISION_TYPE_STYLE[day.decisionType] : null
  const outcomeStyle = day.outcome ? OUTCOME_STYLE[day.outcome] : null

  return (
    <tr className="border-b last:border-0 align-top">
      <td className="py-1.5 px-2 whitespace-nowrap">
        {formatDayLabel(day.date)}
        {day.dayType === "weekend" && <span className="ml-1 text-[10px] text-muted-foreground">週末</span>}
      </td>
      <td className="py-1.5 px-2">{day.demandLevel ?? "—"}</td>
      <td className="py-1.5 px-2 text-right tabular-nums whitespace-nowrap">
        R{day.aiRank ?? "—"} / {yen(day.aiPrice)}
      </td>
      <td className="py-1.5 px-2 text-right tabular-nums whitespace-nowrap">
        R{day.appliedRank ?? "—"} / {yen(day.appliedPrice)}
      </td>
      <td className="py-1.5 px-2 text-right tabular-nums whitespace-nowrap">
        <span className="font-medium">{signedRank(day.rankDelta)}</span>
        <span className="text-muted-foreground ml-1">
          （{signedYen(day.priceDelta)} / {signedPct(day.priceDeltaPct)}）
        </span>
      </td>
      <td className="py-1.5 px-2 max-w-[16rem]">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1 flex-wrap">
            {decisionStyle && (
              <Badge variant="outline" className={`text-[10px] px-1.5 ${decisionStyle.className}`}>
                {decisionStyle.label}
              </Badge>
            )}
            <span>{day.intentReason ? INTENT_REASON_LABELS[day.intentReason] : "—"}</span>
          </div>
          {day.intentNote && <span className="text-muted-foreground">{day.intentNote}</span>}
          {day.decidedByName && <span className="text-[10px] text-muted-foreground">記録: {day.decidedByName}</span>}
        </div>
      </td>
      <td className="py-1.5 px-2 text-right tabular-nums whitespace-nowrap">
        {day.actualRevPar == null ? (
          <span className="text-muted-foreground">実績待ち</span>
        ) : (
          <>
            {yen(day.actualRevPar)} / {yen(day.estimatedAiRevPar)}
          </>
        )}
      </td>
      <td className="py-1.5 px-2">
        {outcomeStyle ? (
          <Badge variant="outline" className={`text-[10px] px-1.5 ${outcomeStyle.className}`}>
            {outcomeStyle.label}
          </Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
    </tr>
  )
}
