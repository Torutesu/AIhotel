"use client"

// 推奨ランクの調整（#17）。価格戦略の重み（StrategyWeightsCard）と同じ PricingStrategyConfig に保存する。
// 既定値は想定値で、運用しながらホテルごとに変える前提。
// 変更は MANAGER 以上。OPERATOR には読み取り専用で表示する。
// 推奨を固定する期間（団体・契約レートの日など）もここで登録する。

import { useEffect, useState } from "react"
import { Loader2, Lock, Save, SlidersHorizontal, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/error-state"
import { useAuth } from "@/components/auth-provider"
import { useApiQuery } from "@/hooks/use-api-query"
import { api, ApiClientError, type PricingLockPeriod, type PricingStrategy } from "@/lib/api"
import { canManage, ROLE_LABELS } from "@shared/types"

/** フォームの値。数値欄は空文字＝「制限なし」 */
interface FormState {
  competitorOccupancy: "" | "1" | "2"
  competitorOffsetPct: string
  minRank: string
  maxRank: string
  maxDailyRankChange: string
  hysteresisRanks: string
}

function toForm(s: PricingStrategy): FormState {
  return {
    competitorOccupancy: s.competitorOccupancy == null ? "" : (String(s.competitorOccupancy) as "1" | "2"),
    competitorOffsetPct: String(s.competitorOffsetPct),
    minRank: s.minRank == null ? "" : String(s.minRank),
    maxRank: s.maxRank == null ? "" : String(s.maxRank),
    maxDailyRankChange: s.maxDailyRankChange == null ? "" : String(s.maxDailyRankChange),
    hysteresisRanks: String(s.hysteresisRanks),
  }
}

const optionalInt = (v: string): number | null => (v.trim() === "" ? null : Number(v))

/** 入力の検証。バックエンドの updateStrategySchema と同じ範囲 */
export function validateGuardrailForm(f: FormState): string | null {
  const isInt = (v: string) => /^-?\d+$/.test(v.trim())
  if (!isInt(f.competitorOffsetPct) || Math.abs(Number(f.competitorOffsetPct)) > 30) {
    return "競合との価格差は -30〜+30 の整数で入力してください"
  }
  for (const [label, v] of [
    ["推奨ランクの下限", f.minRank],
    ["推奨ランクの上限", f.maxRank],
    ["1回の変動幅", f.maxDailyRankChange],
  ] as const) {
    if (v.trim() !== "" && (!isInt(v) || Number(v) < 1 || Number(v) > 40)) {
      return `${label}は 1〜40 の整数で入力してください（空欄は制限なし）`
    }
  }
  if (!isInt(f.hysteresisRanks) || Number(f.hysteresisRanks) < 0 || Number(f.hysteresisRanks) > 5) {
    return "据え置く差は 0〜5 の整数で入力してください"
  }
  const min = optionalInt(f.minRank)
  const max = optionalInt(f.maxRank)
  if (min != null && max != null && min > max) return "推奨ランクの下限は上限以下にしてください"
  return null
}

export function StrategyGuardrailsCard() {
  const { hotelId, user } = useAuth()
  const canEdit = canManage(user?.role)
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)

  const {
    data: strategy,
    loading,
    error,
    reload,
    setData: setStrategy,
  } = useApiQuery<PricingStrategy>(
    hotelId ? () => api.pricingStrategy(hotelId) : null,
    [hotelId],
    "価格戦略の取得に失敗しました",
  )

  useEffect(() => {
    if (strategy) setForm(toForm(strategy))
  }, [strategy])

  const validationError = form ? validateGuardrailForm(form) : null
  const isDirty = !!(form && strategy && JSON.stringify(form) !== JSON.stringify(toForm(strategy)))

  const update = (key: keyof FormState, value: string) => setForm((prev) => (prev ? { ...prev, [key]: value } : prev))

  const handleSave = async () => {
    // 保存先は読み込んだホテル。選択中のホテルとずれていれば保存しない（#91）
    if (!hotelId || !form || !strategy || strategy.hotelId !== hotelId || validationError) return
    setSaving(true)
    try {
      const updated = await api.updatePricingStrategy(hotelId, {
        // 重みは送らない（重みのカードで保存した値を古い値で上書きしないため）
        competitorOccupancy: form.competitorOccupancy === "" ? null : (Number(form.competitorOccupancy) as 1 | 2),
        competitorOffsetPct: Number(form.competitorOffsetPct),
        minRank: optionalInt(form.minRank),
        maxRank: optionalInt(form.maxRank),
        maxDailyRankChange: optionalInt(form.maxDailyRankChange),
        hysteresisRanks: Number(form.hysteresisRanks),
      })
      setStrategy(updated)
      toast.success("推奨の調整を保存しました。次の再計算から反映されます")
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "推奨の調整の保存に失敗しました")
    } finally {
      setSaving(false)
    }
  }

  const disabled = !canEdit || saving

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base font-medium">
              <SlidersHorizontal className="h-4 w-4" aria-hidden />
              推奨の調整
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              AIの推奨ランクにかける条件です。次の再計算（日次、または「AI予測値へリセット」）から反映されます。
              {!canEdit && `（変更には${ROLE_LABELS.MANAGER}以上の権限が必要です）`}
            </p>
          </div>
          {canEdit && form && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => strategy && setForm(toForm(strategy))}
                disabled={saving || !isDirty}
              >
                取り消し
              </Button>
              <Button size="sm" className="gap-2" onClick={handleSave} disabled={saving || !isDirty || !!validationError}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
                保存
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6 pt-0">
        {loading || (!form && !error) ? (
          <Skeleton className="h-40 w-full" />
        ) : error || !form ? (
          <ErrorState message={error ?? "価格戦略の取得に失敗しました"} onRetry={reload} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="guard-occupancy"
              label="競合と比べる人数"
              help="「自動」はホテルタイプから決めます（宿泊特化は1名、それ以外は2名）"
            >
              <select
                id="guard-occupancy"
                value={form.competitorOccupancy}
                disabled={disabled}
                onChange={(e) => update("competitorOccupancy", e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60"
              >
                <option value="">自動（ホテルタイプから）</option>
                <option value="1">1名料金</option>
                <option value="2">2名料金</option>
              </select>
            </Field>
            <Field id="guard-offset" label="競合との価格差（%）" help="+10 なら競合の中央値より10%高く、-10 なら10%安くを狙います（-30〜+30）">
              <Input id="guard-offset" inputMode="numeric" value={form.competitorOffsetPct} disabled={disabled} onChange={(e) => update("competitorOffsetPct", e.target.value)} />
            </Field>
            <Field id="guard-min" label="推奨ランクの下限" help="これより安いランクは推奨しません（空欄は制限なし）">
              <Input id="guard-min" inputMode="numeric" value={form.minRank} disabled={disabled} onChange={(e) => update("minRank", e.target.value)} />
            </Field>
            <Field id="guard-max" label="推奨ランクの上限" help="これより高いランクは推奨しません（空欄は制限なし）">
              <Input id="guard-max" inputMode="numeric" value={form.maxRank} disabled={disabled} onChange={(e) => update("maxRank", e.target.value)} />
            </Field>
            <Field id="guard-change" label="1回の変動幅（ランク）" help="前回の推奨から1回の再計算で動かすランク数の上限です（空欄は制限なし）">
              <Input id="guard-change" inputMode="numeric" value={form.maxDailyRankChange} disabled={disabled} onChange={(e) => update("maxDailyRankChange", e.target.value)} />
            </Field>
            <Field id="guard-hysteresis" label="据え置く差（ランク）" help="前回の推奨との差がこのランク数以内なら変えません（0 は常に更新）">
              <Input id="guard-hysteresis" inputMode="numeric" value={form.hysteresisRanks} disabled={disabled} onChange={(e) => update("hysteresisRanks", e.target.value)} />
            </Field>
            {validationError && (
              <p role="alert" className="text-xs text-negative sm:col-span-2">
                {validationError}
              </p>
            )}
          </div>
        )}

        <PricingLocksSection canEdit={canEdit} />
      </CardContent>
    </Card>
  )
}

function Field({ id, label, help, children }: { id: string; label: string; help: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
      </Label>
      {children}
      <p className="text-xs text-muted-foreground">{help}</p>
    </div>
  )
}

function PricingLocksSection({ canEdit }: { canEdit: boolean }) {
  const { hotelId } = useAuth()
  const [draft, setDraft] = useState({ startDate: "", endDate: "", reason: "" })
  const [busy, setBusy] = useState(false)

  const { data: locks, loading, error, reload, setData: setLocks } = useApiQuery<PricingLockPeriod[]>(
    hotelId ? () => api.pricingLocks(hotelId) : null,
    [hotelId],
    "推奨を固定する期間の取得に失敗しました",
  )

  const draftError =
    draft.startDate && draft.endDate && draft.startDate > draft.endDate ? "開始日は終了日以前にしてください" : null

  const handleAdd = async () => {
    if (!hotelId || !draft.startDate || !draft.endDate || draftError) return
    setBusy(true)
    try {
      const created = await api.createPricingLock({
        hotelId,
        startDate: draft.startDate,
        endDate: draft.endDate,
        reason: draft.reason.trim() || undefined,
      })
      setLocks([...(locks ?? []), created].sort((a, b) => a.startDate.localeCompare(b.startDate)))
      setDraft({ startDate: "", endDate: "", reason: "" })
      toast.success("推奨を固定する期間を登録しました")
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "期間の登録に失敗しました")
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (lock: PricingLockPeriod) => {
    if (!hotelId) return
    setBusy(true)
    try {
      await api.deletePricingLock(hotelId, lock.id)
      setLocks((locks ?? []).filter((l) => l.id !== lock.id))
      toast.success("期間を削除しました")
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "期間の削除に失敗しました")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 border-t pt-4">
      <div>
        <h4 className="flex items-center gap-2 text-sm font-medium">
          <Lock className="h-4 w-4" aria-hidden />
          推奨を固定する期間
        </h4>
        <p className="text-xs text-muted-foreground">
          団体・契約レートの日など、AIに推奨を変えてほしくない期間です。期間内の日は再計算しても前回の推奨のままになります。
        </p>
      </div>

      {loading ? (
        <Skeleton className="h-10 w-full" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : locks && locks.length > 0 ? (
        <ul className="divide-y rounded-md border text-sm">
          {locks.map((lock) => (
            <li key={lock.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <span>
                {lock.startDate.slice(0, 10)} 〜 {lock.endDate.slice(0, 10)}
                {lock.reason && <span className="ml-2 text-muted-foreground">{lock.reason}</span>}
              </span>
              {canEdit && (
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => handleDelete(lock)} aria-label={`${lock.startDate.slice(0, 10)}からの期間を削除`}>
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">登録された期間はありません。</p>
      )}

      {canEdit && (
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end">
          <div className="space-y-1">
            <Label htmlFor="lock-start" className="text-xs">開始日</Label>
            <Input id="lock-start" type="date" value={draft.startDate} disabled={busy} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="lock-end" className="text-xs">終了日</Label>
            <Input id="lock-end" type="date" value={draft.endDate} disabled={busy} onChange={(e) => setDraft({ ...draft, endDate: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="lock-reason" className="text-xs">理由（任意）</Label>
            <Input id="lock-reason" value={draft.reason} maxLength={200} disabled={busy} placeholder="例: 修学旅行の団体" onChange={(e) => setDraft({ ...draft, reason: e.target.value })} />
          </div>
          <Button size="sm" onClick={handleAdd} disabled={busy || !draft.startDate || !draft.endDate || !!draftError}>
            追加
          </Button>
          {draftError && (
            <p role="alert" className="text-xs text-negative sm:col-span-4">
              {draftError}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
