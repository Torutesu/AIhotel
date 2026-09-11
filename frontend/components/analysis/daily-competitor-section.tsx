"use client"

// 日別競合価格比較（U-15 で daily-analysis-tab.tsx から分割）
// GET /daily/competitor-prices の実データを表示する。

import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, BarChart3 } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { DatePicker } from "@/components/date-picker"
import { ErrorState } from "@/components/error-state"
import { useAuth } from "@/components/auth-provider"
import { useWeekend } from "@/hooks/use-weekend"
import { api, ApiClientError, type CompetitorPrices } from "@/lib/api"
import { DAY_NAMES, toDateStr } from "@/lib/date"
import { formatPt, formatSignedYen, formatYen as yen } from "@/lib/format"

/**
 * 競合比較テーブルの 1 行。
 * 自館価格は `own_<人数>名`、競合価格は `<競合ID>_<人数>名` の動的キーに入る（#57）。
 */
interface CompetitorComparisonRow {
  date: string
  /** 曜日番号（0=日〜6=土）。週末判定に使う */
  dow: number
  day: string
  [key: string]: string | number | null
}

function occLabel(occ: number): string {
  return occ >= 4 ? "4名以上" : `${occ}名`
}

/** 自館価格の行キー（利用人数別 — #57） */
function ownKey(occ: number): string {
  return `own_${occ}名`
}

/**
 * 価格差の向きは全画面で「自館 − 競合」に統一する（#57）。
 * ＋＝自館のほうが高い／−＝自館のほうが安い。
 * 符号を必ず表示し、色だけに依存させない（色覚特性への配慮）。
 */
function diffToneClass(diff: number | null): string {
  if (diff == null) return ""
  return diff >= 0 ? "text-positive" : "text-negative"
}

function avgOf(rows: Array<Record<string, unknown>>, key: string): number | null {
  const vals = rows.map((r) => r[key]).filter((v): v is number => typeof v === "number")
  if (vals.length === 0) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

/** 競合ホテルとの価格比較分析（実データ: api.competitorPrices。注意事項アラートを含む） */
export function DailyCompetitorSection() {
  const { hotelId } = useAuth()
  const { isWeekendDow } = useWeekend()

  // ---- 競合価格比較（実データ: api.competitorPrices。日付選択による1週間単位表示） ----
  const [weekStart, setWeekStart] = useState(() => toDateStr(new Date()))
  const weekEnd = useMemo(() => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + 6)
    return toDateStr(d)
  }, [weekStart])
  const [selectedOccupancies, setSelectedOccupancies] = useState<number[]>([1])
  const [selectedCompetitorIds, setSelectedCompetitorIds] = useState<string[]>([])
  const [competitorData, setCompetitorData] = useState<CompetitorPrices | null>(null)
  const [competitorLoading, setCompetitorLoading] = useState(false)
  const [competitorError, setCompetitorError] = useState<string | null>(null)

  const loadCompetitorPrices = useCallback(async () => {
    if (!hotelId) return
    setCompetitorLoading(true)
    setCompetitorError(null)
    try {
      const result = await api.competitorPrices(hotelId, weekStart, weekEnd)
      setCompetitorData(result)
      setSelectedCompetitorIds((prev) => {
        if (prev.length > 0) return prev.filter((id) => result.competitors.some((c) => c.id === id))
        return result.competitors.slice(0, 3).map((c) => c.id)
      })
    } catch (err) {
      setCompetitorError(err instanceof ApiClientError ? err.message : "競合価格の取得に失敗しました")
    } finally {
      setCompetitorLoading(false)
    }
  }, [hotelId, weekStart, weekEnd])

  useEffect(() => {
    loadCompetitorPrices()
  }, [loadCompetitorPrices])

  const shiftWeek = (deltaDays: number) => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + deltaDays)
    setWeekStart(toDateStr(d))
  }

  const selectedCompetitors = useMemo(
    () => (competitorData?.competitors ?? []).filter((c) => selectedCompetitorIds.includes(c.id)),
    [competitorData, selectedCompetitorIds]
  )

  // 自館・競合ともに同じ人数区分のキーを引く（4名以上は3名料金で代用する）
  const priceKeyFor = (occ: number): "price1P" | "price2P" | "price3P" =>
    occ === 1 ? "price1P" : occ === 2 ? "price2P" : "price3P"

  // 各日付に対して、当ホテル・選択された競合の人数別価格をまとめたデータ（1週間分）
  const competitorComparisonData = useMemo(() => {
    if (!competitorData) return []
    const ownByDate = new Map(competitorData.ownPrices.map((p) => [p.date, p]))
    const compByDate = selectedCompetitors.map((c) => ({
      id: c.id,
      name: c.name,
      byDate: new Map(c.prices.map((p) => [p.date, p])),
    }))

    const dates = competitorData.ownPrices.map((p) => p.date)
    return dates.map((date) => {
      const d = new Date(date)
      const own = ownByDate.get(date)
      const result: CompetitorComparisonRow = {
        date: `${d.getMonth() + 1}/${d.getDate()}`,
        dow: d.getDay(),
        day: DAY_NAMES[d.getDay()],
      }
      // 自館価格も利用人数別に持つ（ADR で全人数を同じ値にしない — #57）
      for (const occ of selectedOccupancies) {
        result[ownKey(occ)] = own ? own[priceKeyFor(occ)] : null
      }
      for (const comp of compByDate) {
        const priceRow = comp.byDate.get(date)
        for (const occ of selectedOccupancies) {
          result[`${comp.id}_${occ}名`] = priceRow ? priceRow[priceKeyFor(occ)] : null
        }
      }
      return result
    })
  }, [competitorData, selectedCompetitors, selectedOccupancies])

  return (
    /* Competitor Comparison Section */
    <Card className="border-l-4 border-l-[color:var(--chart-4)]">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <BarChart3 className="w-4 h-4" />
            競合ホテルとの価格比較分析
          </CardTitle>
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Label htmlFor="competitor-week-start" className="text-xs whitespace-nowrap">表示週</Label>
              <Button variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={() => shiftWeek(-7)}>
                ← 前週
              </Button>
              <DatePicker
                id="competitor-week-start"
                value={new Date(weekStart)}
                onChange={(date) => date && setWeekStart(toDateStr(date))}
                placeholder="開始日を選択"
                ariaLabel="競合価格比較の表示週の開始日"
              />
              <span className="text-xs text-muted-foreground whitespace-nowrap">から1週間</span>
              <Button variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={() => shiftWeek(7)}>
                次週 →
              </Button>
            </div>
            <fieldset className="flex items-center gap-2">
              <legend className="sr-only">利用人数</legend>
              <span className="text-xs whitespace-nowrap font-medium">利用人数:</span>
              <div className="flex items-center gap-3 flex-wrap">
                {[1, 2, 3].map((occ) => (
                  <div key={occ} className="flex items-center gap-1.5">
                    <Checkbox
                      id={`occupancy-${occ}`}
                      checked={selectedOccupancies.includes(occ)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedOccupancies([...selectedOccupancies, occ].sort())
                        } else {
                          const newOccupancies = selectedOccupancies.filter((o) => o !== occ)
                          // 少なくとも1つは選択されている必要がある
                          if (newOccupancies.length > 0) {
                            setSelectedOccupancies(newOccupancies)
                          }
                        }
                      }}
                    />
                    <Label htmlFor={`occupancy-${occ}`} className="text-xs cursor-pointer">
                      {occ}名利用
                    </Label>
                  </div>
                ))}
                <div className="flex items-center gap-1.5">
                  <Checkbox
                    id="occupancy-4plus"
                    checked={selectedOccupancies.some((o) => o >= 4)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        // 4名以上を選択（4として扱う）
                        if (!selectedOccupancies.includes(4)) {
                          setSelectedOccupancies([...selectedOccupancies, 4].sort())
                        }
                      } else {
                        // 4名以上を削除
                        setSelectedOccupancies(selectedOccupancies.filter((o) => o < 4))
                      }
                    }}
                  />
                  <Label htmlFor="occupancy-4plus" className="text-xs cursor-pointer">
                    4名以上
                  </Label>
                </div>
              </div>
            </fieldset>
            <fieldset className="flex items-center gap-2">
              <legend className="sr-only">比較ホテル</legend>
              <span className="text-xs whitespace-nowrap font-medium">比較ホテル:</span>
              <div className="flex items-center gap-3 flex-wrap">
                {(competitorData?.competitors ?? []).map((c) => (
                  <div key={c.id} className="flex items-center gap-1.5">
                    <Checkbox
                      id={`competitor-${c.id}`}
                      checked={selectedCompetitorIds.includes(c.id)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedCompetitorIds([...selectedCompetitorIds, c.id])
                        } else {
                          const newIds = selectedCompetitorIds.filter((id) => id !== c.id)
                          // 少なくとも1つは選択されている必要がある
                          if (newIds.length > 0) {
                            setSelectedCompetitorIds(newIds)
                          }
                        }
                      }}
                    />
                    <Label htmlFor={`competitor-${c.id}`} className="text-xs cursor-pointer">
                      {c.name}
                    </Label>
                  </div>
                ))}
                {competitorData && competitorData.competitors.length === 0 && (
                  <span className="text-xs text-muted-foreground">登録された競合ホテルがありません</span>
                )}
              </div>
            </fieldset>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        {/* 注意事項アラート */}
        <Alert className="bg-warning/10 border-warning/30">
          <AlertTriangle className="h-4 w-4 text-warning" />
          <AlertTitle className="text-sm text-warning font-semibold">データ取り扱いに関する注意事項</AlertTitle>
          <AlertDescription className="text-xs text-warning/90 mt-1 space-y-1">
            <p>• 競合データは参考値であり、実際の価格設定には複数の要因（立地、設備、サービス品質等）を総合的に考慮してください。</p>
            <p>• 表示期間: {weekStart} 〜 {weekEnd}（1週間単位）</p>
            <p>• データ取得日時: {new Date().toLocaleString("ja-JP")}</p>
          </AlertDescription>
        </Alert>

        {competitorLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : competitorError ? (
          <ErrorState message={competitorError} onRetry={loadCompetitorPrices} />
        ) : selectedCompetitors.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">比較する競合ホテルを選択してください。</p>
        ) : (
          // ホテルごとにサマリーカードと日別比較テーブルをグルーピングして表示
          <div className="space-y-6">
            {selectedCompetitors.map((comp) => (
              <div key={comp.id} className="space-y-3">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-semibold">{comp.name}</h4>
                  <div className="flex-1 border-t border-border"></div>
                </div>

                {/* 週平均サマリーカード（人数別） */}
                <div className="flex gap-3 flex-wrap">
                  {selectedOccupancies.map((occ) => {
                    // 自館価格も利用人数別に平均する（全人数で同じ値にしない — #57）
                    const ourAvg = avgOf(competitorComparisonData, ownKey(occ))
                    const compAvg = avgOf(competitorComparisonData, `${comp.id}_${occ}名`)
                    const diff = ourAvg != null && compAvg != null ? ourAvg - compAvg : null
                    const diffPercent = diff != null && compAvg ? (diff / compAvg) * 100 : null

                    return (
                      <Card key={`${comp.id}-${occ}`} className="w-full sm:min-w-[200px] sm:flex-1 sm:max-w-[250px]">
                        <CardContent className="py-2.5 px-3">
                          <p className="text-xs text-muted-foreground mb-1">{occLabel(occ)}</p>
                          <div className="text-lg font-semibold mb-0.5">
                            {yen(ourAvg)} / {yen(compAvg)}
                          </div>
                          {diff != null ? (
                            <div className={`text-sm font-medium ${diffToneClass(diff)}`}>
                              {formatSignedYen(diff)}（{formatPt(diffPercent)}）
                            </div>
                          ) : (
                            <div className="text-sm text-muted-foreground">-</div>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">当ホテル / {comp.name}</p>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>

                {/* 日別競合価格比較テーブル（1週間分） */}
                {selectedOccupancies.map((occ) => (
                  <Card key={`table-${comp.id}-${occ}`}>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">日別競合価格比較 ({occLabel(occ)})</CardTitle>
                      <p className="text-xs text-muted-foreground">
                        {weekStart} 〜 {weekEnd} の当ホテルと{comp.name}の比較
                      </p>
                      {/* 符号の意味を明示する（色だけで方向を判断させない — #57） */}
                      <p className="text-xs text-muted-foreground">
                        価格差・差額率は「当ホテル − {comp.name}」。＋は当ホテルのほうが高く、−は当ホテルのほうが安いことを表します。
                      </p>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left py-2 px-2 font-medium">日付</th>
                              <th className="text-left py-2 px-2 font-medium">曜日</th>
                              <th className="text-right py-2 px-2 font-medium">当ホテル</th>
                              <th className="text-right py-2 px-2 font-medium">{comp.name}</th>
                              <th className="text-right py-2 px-2 font-medium">価格差</th>
                              <th className="text-right py-2 px-2 font-medium">差額率</th>
                            </tr>
                          </thead>
                          <tbody>
                            {competitorComparisonData.map((row) => {
                              const ourPrice = row[ownKey(occ)] as number | null
                              const compPrice = row[`${comp.id}_${occ}名`] as number | null
                              const diff = ourPrice != null && compPrice != null ? ourPrice - compPrice : null
                              const diffPercent = diff != null && compPrice ? (diff / compPrice) * 100 : null
                              return (
                                <tr key={`${comp.id}-${occ}-${row.date}`} className="border-b hover:bg-muted/50">
                                  <td className="py-2 px-2 font-medium">{row.date}</td>
                                  <td className="py-2 px-2">
                                    <Badge
                                      variant={isWeekendDow(Number(row.dow)) ? "default" : "outline"}
                                      className="text-xs"
                                    >
                                      {row.day}
                                    </Badge>
                                  </td>
                                  <td className="text-right py-2 px-2 font-medium">{yen(ourPrice)}</td>
                                  <td className="text-right py-2 px-2">{yen(compPrice)}</td>
                                  {/* 符号付きで表示し、色だけに方向の判断を委ねない（#57） */}
                                  <td className={`text-right py-2 px-2 font-medium ${diffToneClass(diff)}`}>
                                    {formatSignedYen(diff)}
                                  </td>
                                  <td className={`text-right py-2 px-2 ${diffToneClass(diff)}`}>
                                    {formatPt(diffPercent)}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground">
              ※ 月別表示・期間集計（平均値）は各種分析タブへの移行を含めて検討中です
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// 旧「日別分析」タブのコンテナは分析タブへ統合したため削除した。
// 上記の各セクションは components/tabs/analysis-tab.tsx から利用している。
