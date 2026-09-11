"use client"

// 着地予測サマリー（U-2 / F-DP-03・F-DP-04）
// 着地予測値は GET /api/v1/pricing/simulation（MonthlyLandingSimulation）を唯一の出所とする。
// 行が無い月は画面側で平均を捏造せず、生成元（再計算／日次バッチ）を案内する空状態を出す。

import { useCallback, useEffect, useMemo, useState } from "react"
import { Loader2, RefreshCw, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { ErrorState } from "@/components/error-state"
import { useAuth } from "@/components/auth-provider"
import { api, ApiClientError, type PricingSimulation } from "@/lib/api"
import { daysInMonth, monthLabel, startOfToday, toDateStr } from "@/lib/date"
import { formatPercent as pct, formatYen as yen } from "@/lib/format"
import { canManage } from "@shared/types"

/** カレンダー実績から算出した現在値（実データのみ。未確定なら null） */
export interface CurrentPerformance {
  adr: number | null
  occupancy: number | null
  revPar: number | null
}

interface LandingForecastSummaryProps {
  year: number
  month: number
  current: CurrentPerformance
  /** 実績値の読み込み中か（カレンダー取得と歩調を合わせる） */
  currentLoading: boolean
  /** 再計算後にカレンダー等を再取得させる */
  onRecomputed?: () => void | Promise<void>
}

export function LandingForecastSummary({
  year,
  month,
  current,
  currentLoading,
  onRecomputed,
}: LandingForecastSummaryProps) {
  const { hotelId, user } = useAuth()
  const canRecompute = canManage(user?.role)

  const [data, setData] = useState<PricingSimulation | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [recomputing, setRecomputing] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const load = useCallback(async () => {
    if (!hotelId) return
    setLoading(true)
    setError(null)
    try {
      setData(await api.pricingSimulation(hotelId, year, month))
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "着地予測の取得に失敗しました")
    } finally {
      setLoading(false)
    }
  }, [hotelId, year, month])

  useEffect(() => {
    load()
  }, [load])

  // 再計算できる期間。バックエンドは過去日の startDate を拒否するため本日以降に丸める
  const recomputeRange = useMemo(() => {
    const today = startOfToday()
    const monthStart = new Date(year, month - 1, 1)
    const monthEnd = new Date(year, month - 1, daysInMonth(year, month))
    const start = monthStart < today ? today : monthStart
    if (start > monthEnd) return null
    return { startDate: toDateStr(start), endDate: toDateStr(monthEnd) }
  }, [year, month])

  const handleRecompute = async () => {
    if (!hotelId || !recomputeRange) return
    setRecomputing(true)
    try {
      const result = await api.recomputeForecast(hotelId, recomputeRange)
      toast.success("AI予測値へリセットしました", {
        description: `${result.startDate} 〜 ${result.endDate} の${result.count}日分を再計算しました。`,
      })
      await load()
      await onRecomputed?.()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "AI予測値のリセットに失敗しました")
    } finally {
      setRecomputing(false)
    }
  }

  const simulation = data?.simulation ?? null
  const budget = data?.budget ?? null

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">着地予測（{monthLabel(year, month)}）</h3>
          <p className="text-xs text-muted-foreground">
            着地予測値はAIの需要予測から生成された月次シミュレーションです（画面側で平均を計算したものではありません）
          </p>
        </div>
        {canRecompute && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-2 text-xs"
            disabled={recomputing || recomputeRange == null}
            title={
              recomputeRange == null
                ? "過去の月は再計算できません（開始日は本日以降である必要があります）"
                : undefined
            }
            onClick={() => setConfirmOpen(true)}
          >
            {recomputing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
            )}
            AI予測値へリセット
          </Button>
        )}
      </div>

      {/* サマリーカード（現在値＝カレンダー実績／着地予測＝シミュレーション） */}
      {currentLoading || loading ? (
        <div className="grid grid-cols-1 gap-3 border-t pt-2.5 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 border-t pt-2.5 sm:grid-cols-3 lg:grid-cols-6">
            <div className="flex flex-col">
              <p className="mb-0.5 text-xs text-muted-foreground">現在のADR</p>
              <div className="mb-0.5 text-lg font-semibold">{yen(current.adr)}</div>
            </div>
            <div className="flex flex-col">
              <p className="mb-0.5 text-xs text-muted-foreground">現在の稼働率</p>
              <div className="mb-0.5 text-lg font-semibold">{pct(current.occupancy)}</div>
            </div>
            <div className="flex flex-col">
              <p className="mb-0.5 text-xs text-muted-foreground">現在のREV-Per</p>
              <div className="mb-0.5 text-lg font-semibold">{yen(current.revPar)}</div>
            </div>
            <div className="flex flex-col">
              <p className="mb-0.5 text-xs text-muted-foreground">着地予測ADR（AI予測）</p>
              <div className="mb-0.5 text-lg font-semibold text-primary">
                {simulation ? yen(simulation.projectedAdr) : "未生成"}
              </div>
            </div>
            <div className="flex flex-col">
              <p className="mb-0.5 text-xs text-muted-foreground">着地予測稼働率（AI予測）</p>
              <div className="mb-0.5 text-lg font-semibold text-primary">
                {simulation ? pct(simulation.projectedOccupancy) : "未生成"}
              </div>
            </div>
            <div className="flex flex-col">
              <p className="mb-0.5 text-xs text-muted-foreground">着地予測REV-Per（AI予測）</p>
              <div className="mb-0.5 text-lg font-semibold text-primary">
                {simulation ? yen(simulation.projectedRevPar) : "未生成"}
              </div>
            </div>
          </div>

          {simulation ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-2 text-xs text-muted-foreground">
              <span>
                着地予測室料売上: <span className="font-medium text-foreground">{yen(simulation.projectedRevenue)}</span>
              </span>
              {budget?.budgetRevenue != null && (
                <span>
                  月次予算: <span className="font-medium text-foreground">{yen(budget.budgetRevenue)}</span>
                  {simulation.projectedRevenue != null && budget.budgetRevenue > 0 && (
                    <span className="ml-1">
                      （予算比 {((simulation.projectedRevenue / budget.budgetRevenue) * 100).toFixed(1)}%）
                    </span>
                  )}
                </span>
              )}
              <span>
                生成日時: {new Date(simulation.computedAt).toLocaleString("ja-JP")}
              </span>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
              <p className="font-medium text-foreground">この月の着地予測はまだ生成されていません。</p>
              <p className="mt-1">
                着地予測は需要予測の再計算（下記「AI予測値へリセット」）または日次バッチで生成されます。
                実績値の平均で代用した数値は表示しません。
              </p>
              {!canRecompute && (
                <p className="mt-1">再計算はMANAGER以上のユーザーが実行できます。</p>
              )}
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="AI予測値へリセットしますか？"
        description={
          recomputeRange
            ? `${recomputeRange.startDate} 〜 ${recomputeRange.endDate} のAI推奨価格・需要予測を再計算し、現在の推奨値を上書きします。この操作は取り消せません。`
            : undefined
        }
        confirmLabel="リセットする"
        onConfirm={() => {
          setConfirmOpen(false)
          void handleRecompute()
        }}
      />

      {recomputing && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <RefreshCw className="h-3 w-3 animate-spin" aria-hidden />
          再計算中です。完了までしばらくお待ちください。
        </p>
      )}
    </div>
  )
}
