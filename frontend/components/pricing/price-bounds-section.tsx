"use client"

// 期間・曜日ごとの価格の幅（推奨ランクの下限・上限 — D-11）。
// IDeaS（G3）を使うホテルは、推奨の数字を直接教えるのではなく「動ける幅（Floor / Ceiling）」を期間ごとに決めてコントロールしている。
// 予約が悪ければ上限を下げ、良すぎれば下限を上げる。ホテル全体の下限・上限より優先し、重なった期間は後から登録したものを優先する。
// 登録・削除は MANAGER 以上。次の再計算から反映される。

import { useState } from "react"
import { MoveVertical, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/error-state"
import { useAuth } from "@/components/auth-provider"
import { useApiQuery } from "@/hooks/use-api-query"
import { api, ApiClientError, type PriceBoundPeriod } from "@/lib/api"

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"]

export interface PriceBoundDraft {
  startDate: string
  endDate: string
  weekdays: number[]
  minRank: string
  maxRank: string
  reason: string
}

const EMPTY_DRAFT: PriceBoundDraft = { startDate: "", endDate: "", weekdays: [], minRank: "", maxRank: "", reason: "" }

/** 入力の検証。バックエンドの createPriceBoundSchema と同じ条件 */
export function validatePriceBoundDraft(draft: PriceBoundDraft): string | null {
  if (!draft.startDate || !draft.endDate) return "開始日と終了日を入力してください"
  if (draft.startDate > draft.endDate) return "開始日は終了日以前にしてください"
  const rank = (v: string) => (v.trim() === "" ? null : Number(v))
  const min = rank(draft.minRank)
  const max = rank(draft.maxRank)
  for (const [label, v] of [
    ["下限", min],
    ["上限", max],
  ] as const) {
    if (v != null && (!Number.isInteger(v) || v < 1 || v > 40)) return `${label}は 1〜40 の整数で入力してください`
  }
  if (min == null && max == null) return "下限か上限の少なくとも一方を入力してください"
  if (min != null && max != null && min > max) return "下限は上限以下にしてください"
  return null
}

/** 一覧の1行の説明（例: 「金・土 R20〜R38」「全日 下限 R30」） */
export function describePriceBound(bound: Pick<PriceBoundPeriod, "weekdays" | "minRank" | "maxRank">): string {
  const days = bound.weekdays.length === 0 ? "全日" : bound.weekdays.map((d) => WEEKDAY_LABELS[d]).join("・")
  const r = (rank: number) => `R${String(rank).padStart(2, "0")}`
  const range =
    bound.minRank != null && bound.maxRank != null
      ? `${r(bound.minRank)}〜${r(bound.maxRank)}`
      : bound.minRank != null
        ? `下限 ${r(bound.minRank)}`
        : `上限 ${r(bound.maxRank as number)}`
  return `${days} ${range}`
}

export function PriceBoundsSection({ canEdit }: { canEdit: boolean }) {
  const { hotelId } = useAuth()
  const [draft, setDraft] = useState<PriceBoundDraft>(EMPTY_DRAFT)
  const [busy, setBusy] = useState(false)

  const { data: bounds, loading, error, reload, setData: setBounds } = useApiQuery<PriceBoundPeriod[]>(
    hotelId ? () => api.priceBounds(hotelId) : null,
    [hotelId],
    "価格の幅の取得に失敗しました",
  )

  const touched = draft.startDate !== "" || draft.endDate !== "" || draft.minRank !== "" || draft.maxRank !== ""
  const draftError = touched ? validatePriceBoundDraft(draft) : null

  const toggleWeekday = (day: number) =>
    setDraft((prev) => ({
      ...prev,
      weekdays: prev.weekdays.includes(day) ? prev.weekdays.filter((d) => d !== day) : [...prev.weekdays, day].sort(),
    }))

  const handleAdd = async () => {
    if (!hotelId || validatePriceBoundDraft(draft)) return
    setBusy(true)
    try {
      const created = await api.createPriceBound({
        hotelId,
        startDate: draft.startDate,
        endDate: draft.endDate,
        weekdays: draft.weekdays,
        minRank: draft.minRank.trim() === "" ? null : Number(draft.minRank),
        maxRank: draft.maxRank.trim() === "" ? null : Number(draft.maxRank),
        reason: draft.reason.trim() || undefined,
      })
      setBounds([...(bounds ?? []), created].sort((a, b) => a.startDate.localeCompare(b.startDate)))
      setDraft(EMPTY_DRAFT)
      toast.success("価格の幅を登録しました。次の再計算から反映されます")
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "価格の幅の登録に失敗しました")
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (bound: PriceBoundPeriod) => {
    if (!hotelId) return
    setBusy(true)
    try {
      await api.deletePriceBound(hotelId, bound.id)
      setBounds((bounds ?? []).filter((b) => b.id !== bound.id))
      toast.success("価格の幅を削除しました")
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "価格の幅の削除に失敗しました")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 border-t pt-4">
      <div>
        <h4 className="flex items-center gap-2 text-sm font-medium">
          <MoveVertical className="h-4 w-4" aria-hidden />
          期間・曜日ごとの価格の幅（下限・上限）
        </h4>
        <p className="text-xs text-muted-foreground">
          推奨の金額を直接決めるのではなく、AIが動ける幅を決めます。予約の入りが悪い期間は上限を下げ、良すぎる期間は下限を上げます。
          上のホテル全体の下限・上限より優先し、重なった期間は後から登録したものを優先します。
        </p>
      </div>

      {loading ? (
        <Skeleton className="h-10 w-full" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : bounds && bounds.length > 0 ? (
        <ul className="divide-y rounded-md border text-sm">
          {bounds.map((bound) => (
            <li key={bound.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <span>
                {bound.startDate.slice(0, 10)} 〜 {bound.endDate.slice(0, 10)}
                <span className="ml-2 font-medium">{describePriceBound(bound)}</span>
                {bound.reason && <span className="ml-2 text-muted-foreground">{bound.reason}</span>}
              </span>
              {canEdit && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => handleDelete(bound)}
                  aria-label={`${bound.startDate.slice(0, 10)}からの価格の幅を削除`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">登録された価格の幅はありません。</p>
      )}

      {canEdit && (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor="bound-start" className="text-xs">開始日</Label>
              <Input id="bound-start" type="date" value={draft.startDate} disabled={busy} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bound-end" className="text-xs">終了日</Label>
              <Input id="bound-end" type="date" value={draft.endDate} disabled={busy} onChange={(e) => setDraft({ ...draft, endDate: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bound-min" className="text-xs">下限ランク（Floor）</Label>
              <Input id="bound-min" inputMode="numeric" placeholder="例: 20" value={draft.minRank} disabled={busy} onChange={(e) => setDraft({ ...draft, minRank: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bound-max" className="text-xs">上限ランク（Ceiling）</Label>
              <Input id="bound-max" inputMode="numeric" placeholder="例: 35" value={draft.maxRank} disabled={busy} onChange={(e) => setDraft({ ...draft, maxRank: e.target.value })} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="対象の曜日">
            <span className="mr-1 text-xs text-muted-foreground">曜日（選ばなければ全日）</span>
            {WEEKDAY_LABELS.map((label, day) => (
              <Button
                key={label}
                type="button"
                size="sm"
                variant={draft.weekdays.includes(day) ? "default" : "outline"}
                className="h-7 w-8 px-0 text-xs"
                aria-pressed={draft.weekdays.includes(day)}
                disabled={busy}
                onClick={() => toggleWeekday(day)}
              >
                {label}
              </Button>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="space-y-1">
              <Label htmlFor="bound-reason" className="text-xs">理由（任意）</Label>
              <Input id="bound-reason" value={draft.reason} maxLength={200} disabled={busy} placeholder="例: 年末の週末は強気に" onChange={(e) => setDraft({ ...draft, reason: e.target.value })} />
            </div>
            <Button size="sm" onClick={handleAdd} disabled={busy || !touched || !!draftError}>
              追加
            </Button>
          </div>
          {draftError && (
            <p role="alert" className="text-xs text-negative">
              {draftError}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
