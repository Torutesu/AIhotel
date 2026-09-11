"use client"

// 価格戦略の重み付け設定（U-1 / F-DP-02）
// GET/PUT /api/v1/pricing/strategy に接続する。合計は必ず 100% でなければ保存できない。
// 変更は MANAGER 以上。OPERATOR には読み取り専用で表示する。

import { useCallback, useEffect, useMemo, useState } from "react"
import { Loader2, Save, Scale } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/error-state"
import { useAuth } from "@/components/auth-provider"
import { api, ApiClientError, type PricingStrategy } from "@/lib/api"

/** 重みの合計（必須値） */
const TOTAL_WEIGHT = 100

type WeightKey = "weightOccupancy" | "weightAdr" | "weightCompetitor"

const WEIGHT_FIELDS: Array<{ key: WeightKey; label: string; description: string }> = [
  {
    key: "weightOccupancy",
    label: "稼働率重視",
    description: "客室を埋めることを優先し、需要が弱い日は価格を下げやすくなります",
  },
  {
    key: "weightAdr",
    label: "ADR重視",
    description: "単価の維持を優先し、稼働率よりも1室あたりの売上を重視します",
  },
  {
    key: "weightCompetitor",
    label: "競合追従",
    description: "競合ホテルの価格水準（中央値）に合わせて推奨価格を寄せます",
  },
]

interface WeightState {
  weightOccupancy: number
  weightAdr: number
  weightCompetitor: number
}

function toWeightState(strategy: PricingStrategy): WeightState {
  return {
    weightOccupancy: strategy.weightOccupancy,
    weightAdr: strategy.weightAdr,
    weightCompetitor: strategy.weightCompetitor,
  }
}

export function StrategyWeightsCard() {
  const { hotelId, user } = useAuth()
  const canEdit = user?.role === "ADMIN" || user?.role === "MANAGER"

  const [strategy, setStrategy] = useState<PricingStrategy | null>(null)
  const [weights, setWeights] = useState<WeightState>({
    weightOccupancy: 0,
    weightAdr: 0,
    weightCompetitor: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!hotelId) return
    setLoading(true)
    setError(null)
    try {
      const result = await api.pricingStrategy(hotelId)
      setStrategy(result)
      setWeights(toWeightState(result))
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "価格戦略の取得に失敗しました")
    } finally {
      setLoading(false)
    }
  }, [hotelId])

  useEffect(() => {
    load()
  }, [load])

  const total = weights.weightOccupancy + weights.weightAdr + weights.weightCompetitor
  const isValid = total === TOTAL_WEIGHT
  const isDirty = useMemo(() => {
    if (!strategy) return false
    const current = toWeightState(strategy)
    return WEIGHT_FIELDS.some((f) => current[f.key] !== weights[f.key])
  }, [strategy, weights])

  const setWeight = (key: WeightKey, value: number) => {
    const clamped = Math.min(TOTAL_WEIGHT, Math.max(0, Math.round(value)))
    setWeights((prev) => ({ ...prev, [key]: clamped }))
  }

  /** 残り 2 項目を比率どおりに配分し、合計をちょうど 100% に揃える */
  const normalizeFrom = (key: WeightKey) => {
    const others = WEIGHT_FIELDS.map((f) => f.key).filter((k) => k !== key)
    const remaining = TOTAL_WEIGHT - weights[key]
    const othersTotal = others.reduce((sum, k) => sum + weights[k], 0)
    const next: WeightState = { ...weights }
    if (othersTotal === 0) {
      next[others[0]] = Math.round(remaining / 2)
      next[others[1]] = remaining - next[others[0]]
    } else {
      next[others[0]] = Math.round((weights[others[0]] / othersTotal) * remaining)
      next[others[1]] = remaining - next[others[0]]
    }
    setWeights(next)
  }

  const handleSave = async () => {
    if (!hotelId || !isValid) return
    setSaving(true)
    try {
      const updated = await api.updatePricingStrategy(hotelId, weights)
      setStrategy(updated)
      setWeights(toWeightState(updated))
      toast.success("価格戦略の重み付けを保存しました")
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "価格戦略の保存に失敗しました")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base font-medium">
              <Scale className="h-4 w-4" aria-hidden />
              価格戦略の重み付け
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              AIが推奨価格を算出する際の重視度です。合計が100%になるように配分してください。
              {!canEdit && "（変更にはMANAGER以上の権限が必要です）"}
            </p>
          </div>
          {canEdit && !loading && !error && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => strategy && setWeights(toWeightState(strategy))}
                disabled={saving || !isDirty}
              >
                取り消し
              </Button>
              <Button size="sm" className="gap-2" onClick={handleSave} disabled={saving || !isValid || !isDirty}>
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Save className="h-4 w-4" aria-hidden />
                )}
                保存
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <div className="space-y-4">
            {WEIGHT_FIELDS.map((f) => (
              <Skeleton key={f.key} className="h-12 w-full" />
            ))}
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : (
          <div className="space-y-4">
            {WEIGHT_FIELDS.map((field) => (
              <div key={field.key} className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label htmlFor={`weight-${field.key}`} className="text-sm font-medium">
                    {field.label}
                  </Label>
                  <span className="text-sm font-semibold tabular-nums">{weights[field.key]}%</span>
                </div>
                <input
                  id={`weight-${field.key}`}
                  type="range"
                  min={0}
                  max={TOTAL_WEIGHT}
                  step={1}
                  value={weights[field.key]}
                  disabled={!canEdit || saving}
                  aria-describedby={`weight-${field.key}-help`}
                  onChange={(e) => setWeight(field.key, Number(e.target.value))}
                  className="h-2 w-full cursor-pointer appearance-none rounded-full bg-secondary accent-primary disabled:cursor-not-allowed disabled:opacity-60"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p id={`weight-${field.key}-help`} className="text-xs text-muted-foreground">
                    {field.description}
                  </p>
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[11px]"
                      disabled={saving || isValid}
                      onClick={() => normalizeFrom(field.key)}
                    >
                      この値を基準に100%へ調整
                    </Button>
                  )}
                </div>
              </div>
            ))}

            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
              <span className="text-sm text-muted-foreground">合計</span>
              <span
                className={`text-base font-semibold tabular-nums ${isValid ? "text-positive" : "text-negative"}`}
              >
                {total}%
              </span>
            </div>
            {!isValid && (
              <p role="alert" className="text-xs text-negative">
                重みの合計は100%である必要があります（現在 {total}%、
                {total > TOTAL_WEIGHT ? `${total - TOTAL_WEIGHT}%超過` : `残り${TOTAL_WEIGHT - total}%`}）。
              </p>
            )}
            {!canEdit && (
              <p className="text-xs text-muted-foreground">
                現在のロールでは閲覧のみ可能です。変更はMANAGER以上のユーザーに依頼してください。
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
