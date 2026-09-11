"use client"

// 競合価格分析（U-15 で analysis-tab.tsx から分割）。
// GET /analysis/competitor の実データ。代表値は中央値（C-9 / U-13）。

import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle } from "lucide-react"
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from "recharts"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorCard } from "@/components/error-state"
import { useAuth } from "@/components/auth-provider"
import { useTargetPeriod, type AnalysisSectionProps } from "@/components/analysis/section-props"
import { api, ApiClientError, type CompetitorAnalysis } from "@/lib/api"
import { monthRange, parseMonthStr } from "@/lib/date"

export function CompetitorAnalysisSection(props: AnalysisSectionProps) {
  const { hotelId } = useAuth()
  const { targetPeriod } = useTargetPeriod(props)

  const competitorRange = useMemo(() => {
    const { year, month } = parseMonthStr(targetPeriod)
    return monthRange(year, month)
  }, [targetPeriod])

  const [competitorAnalysis, setCompetitorAnalysis] = useState<CompetitorAnalysis | null>(null)
  const [competitorAnalysisLoading, setCompetitorAnalysisLoading] = useState(true)
  const [competitorAnalysisError, setCompetitorAnalysisError] = useState<string | null>(null)

  const loadCompetitorAnalysis = useCallback(async () => {
    if (!hotelId) return
    setCompetitorAnalysisLoading(true)
    setCompetitorAnalysisError(null)
    try {
      const result = await api.competitorAnalysis(hotelId, competitorRange.startDate, competitorRange.endDate)
      setCompetitorAnalysis(result)
    } catch (err) {
      setCompetitorAnalysisError(err instanceof ApiClientError ? err.message : "競合分析データの取得に失敗しました")
    } finally {
      setCompetitorAnalysisLoading(false)
    }
  }, [hotelId, competitorRange])

  useEffect(() => {
    loadCompetitorAnalysis()
  }, [loadCompetitorAnalysis])

  return (
    <div className="space-y-6">
      {/* 注意事項アラート */}
      <Alert className="bg-warning/10 border-warning/30">
        <AlertTriangle className="h-4 w-4 text-warning" />
        <AlertTitle className="text-sm font-semibold text-warning">データ取り扱いに関する注意事項</AlertTitle>
        <AlertDescription className="text-xs text-warning/90 mt-1 space-y-1">
          <p>• 競合データは参考値であり、実際の価格設定には複数の要因（立地、設備、サービス品質等）を総合的に考慮してください。</p>
          <p>• 対象期間: {competitorRange.startDate} 〜 {competitorRange.endDate}（上部の対象期間セレクタで選択した月）</p>
        </AlertDescription>
      </Alert>

      {competitorAnalysisLoading ? (
        <Card>
          <CardContent className="py-8">
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      ) : competitorAnalysisError ? (
        <ErrorCard message={competitorAnalysisError} onRetry={loadCompetitorAnalysis} />
      ) : !competitorAnalysis || competitorAnalysis.competitors.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            対象期間の競合データが登録されていません。
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Card>
              <CardContent className="py-2.5 px-3">
                <p className="text-xs font-medium text-muted-foreground mb-1">競合ホテル数</p>
                <div className="text-lg font-semibold mb-0.5">{competitorAnalysis.competitors.length}件</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-2.5 px-3">
                <p className="text-xs font-medium text-muted-foreground mb-1">競合価格水準（中央値・全社）</p>
                <div className="text-lg font-semibold mb-0.5">
                  {(() => {
                    const medians = competitorAnalysis.competitors
                      .map((c) => c.medianPrice)
                      .filter((v): v is number => v != null)
                      .sort((a, b) => a - b)
                    if (medians.length === 0) return "-"
                    const mid = Math.floor(medians.length / 2)
                    const overall =
                      medians.length % 2 === 0 ? (medians[mid - 1] + medians[mid]) / 2 : medians[mid]
                    return `¥${Math.round(overall).toLocaleString()}`
                  })()}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-2.5 px-3">
                <p className="text-xs font-medium text-muted-foreground mb-1">対象期間</p>
                <div className="text-sm font-semibold mb-0.5">
                  {competitorAnalysis.startDate} 〜 {competitorAnalysis.endDate}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">競合ホテル別の価格水準（中央値）</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">対象期間中の1名料金の中央値</p>
            </CardHeader>
            <CardContent className="pt-0">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={competitorAnalysis.competitors.map((c) => ({
                    name: c.name,
                    medianPrice: c.medianPrice ?? 0,
                  }))}
                  margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="currentColor" opacity={0.5} />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    stroke="currentColor"
                    opacity={0.5}
                    tickFormatter={(value) => `¥${(value / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const value = payload[0].value as number
                        return (
                          <div className="bg-background border border-border rounded-lg shadow-lg p-3">
                            <p className="text-sm font-medium mb-2">{payload[0].payload.name}</p>
                            <p className="text-xs">価格水準（中央値）: ¥{value.toLocaleString()}</p>
                          </div>
                        )
                      }
                      return null
                    }}
                  />
                  <Bar dataKey="medianPrice" fill="#2563eb" radius={[4, 4, 0, 0]} name="価格水準（中央値）" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">競合ホテル一覧</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-2 font-medium">ホテル名</th>
                      <th className="text-left py-2 px-2 font-medium">カテゴリ</th>
                      <th className="text-right py-2 px-2 font-medium">サンプル数</th>
                      <th className="text-right py-2 px-2 font-medium">最低価格</th>
                      <th className="text-right py-2 px-2 font-medium">最高価格</th>
                      <th className="text-right py-2 px-2 font-medium">価格水準（中央値）</th>
                    </tr>
                  </thead>
                  <tbody>
                    {competitorAnalysis.competitors.map((c) => (
                      <tr key={c.id} className="border-b hover:bg-muted/50">
                        <td className="py-2 px-2 font-medium">{c.name}</td>
                        <td className="py-2 px-2">{c.category ?? "-"}</td>
                        <td className="text-right py-2 px-2">{c.sampleSize}件</td>
                        <td className="text-right py-2 px-2">{c.minPrice != null ? `¥${c.minPrice.toLocaleString()}` : "-"}</td>
                        <td className="text-right py-2 px-2">{c.maxPrice != null ? `¥${c.maxPrice.toLocaleString()}` : "-"}</td>
                        <td className="text-right py-2 px-2 font-medium">
                          {c.medianPrice != null ? `¥${c.medianPrice.toLocaleString()}` : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
