"use client"

// リードタイム分析（予約期間別。U-15 で analysis-tab.tsx から分割、D-13 で予約明細の実データに — GET /analysis/booking-windows）。
// 2026-10 PDF c分析03 に合わせて
//  - 期間は 当日〜121-180日前、181日以上前
//  - 予約の表: 販売室数・稼働率・ADR・客単価・室料売上・売上構成比・CXL率・DOR・平均宿泊数・前年同月比
//  - 下に CXL（キャンセル）の表: 室数・CXL率・ADR・客単価・CXL室料・構成比・DOR・平均宿泊数・前年同月比
// 「日のタイプ」の列（xlsx 分析03）は、予約期間ごとの型の推移の集計ができるまで出さない。
// 予約明細が取り込まれていない月は、取り込みの案内を出す（サンプルは出さない）。

import { type ReactNode } from "react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { AnalysisInsightsBody } from "@/components/analysis/analysis-insights"
import { ErrorState } from "@/components/error-state"
import { useAuth } from "@/components/auth-provider"
import { useTargetPeriod, type AnalysisSectionProps } from "@/components/analysis/section-props"
import { useApiQuery } from "@/hooks/use-api-query"
import { api, type BookingWindows } from "@/lib/api"
import { parseMonthStr } from "@/lib/date"
import { formatPercent, formatPt, formatRooms, formatYen } from "@/lib/format"
import { cn } from "@/lib/utils"

const pctText = (v: number | null, digits = 1) => (v == null ? "—" : `${v.toFixed(digits)}%`)
const numText = (v: number | null, digits: number, unit = "") => (v == null ? "—" : `${v.toFixed(digits)}${unit}`)

function signClass(value: number | null): string {
  if (value == null || value === 0) return "text-muted-foreground"
  return value > 0 ? "text-positive" : "text-negative"
}

function Th({ children, left }: { children: ReactNode; left?: boolean }) {
  return <th className={cn("px-2 py-2 font-medium", left ? "text-left" : "text-right")}>{children}</th>
}

function Td({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cn("px-2 py-2 text-right tabular-nums", className)}>{children}</td>
}

export function BookingPeriodAnalysisSection(props: AnalysisSectionProps) {
  const { targetPeriod } = useTargetPeriod(props)
  const { hotelId } = useAuth()
  const { year, month } = parseMonthStr(targetPeriod)
  const query = useApiQuery<BookingWindows>(
    hotelId ? () => api.bookingWindows(hotelId, year, month) : null,
    [hotelId, year, month],
    "予約動向の取得に失敗しました",
  )
  const bookingWindowData = query.data?.bookings ?? []
  const cancelData = query.data?.cancels ?? []

  if (query.loading) return <p className="p-4 text-sm text-muted-foreground">読み込み中…</p>
  if (query.error) return <ErrorState message={query.error} onRetry={query.reload} />

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">リードタイム分析</CardTitle>
          <p className="text-xs text-muted-foreground">
            対象月の泊を、予約が入った時期（チェックイン日の何日前に予約されたか）で分けて集計します。予約明細 {query.data?.reservations ?? 0}件から集計しています。
          </p>
        </CardHeader>
        <CardContent className="space-y-5 pt-0">
          {query.data?.reservations === 0 && (
            <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground" data-testid="no-reservations">
              この月の予約明細がまだ取り込まれていません。設定タブの「予約明細から作る」で PMS・サイトコントローラーの予約明細を取り込むと表示されます。
            </p>
          )}
          <div className="space-y-1.5">
            <h3 className="text-sm font-medium">予約</h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] whitespace-nowrap text-xs" data-testid="lead-time-booking-table">
                <thead>
                  <tr className="border-b">
                    <Th left>期間</Th>
                    <Th>販売室数</Th>
                    <Th>稼働率</Th>
                    <Th>ADR</Th>
                    <Th>客単価</Th>
                    <Th>室料売上</Th>
                    <Th>売上構成比</Th>
                    <Th>CXL率</Th>
                    <Th>DOR</Th>
                    <Th>平均宿泊数</Th>
                    <Th>前年同月比</Th>
                  </tr>
                </thead>
                <tbody>
                  {bookingWindowData.map((row) => (
                    <tr key={row.window} className="border-b hover:bg-muted/50">
                      <td className="px-2 py-2 font-medium">{row.window}</td>
                      <Td>{formatRooms(row.soldRooms)}</Td>
                      <Td>{formatPercent(row.occupancy)}</Td>
                      <Td>{formatYen(row.adr)}</Td>
                      <Td>{formatYen(row.guestUnitPrice)}</Td>
                      <Td className="font-medium">{formatYen(row.revenue)}</Td>
                      <Td>{pctText(row.revenueShare)}</Td>
                      <Td className={(row.cancelRate ?? 0) > 8 ? "text-negative" : undefined}>{pctText(row.cancelRate)}</Td>
                      <Td>{numText(row.dor, 2)}</Td>
                      <Td>{numText(row.avgNights, 1, "泊")}</Td>
                      <Td className={signClass(row.yoy)}>{formatPt(row.yoy)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-muted-foreground">
              ADR・客単価・売上は室料の入った明細だけ、DOR・客単価は人数の入った明細だけで計算します。前年同月比は前年同月の明細があるときだけ出します。
            </p>
          </div>

          <div className="space-y-1.5">
            <h3 className="text-sm font-medium">CXL（キャンセル）</h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] whitespace-nowrap text-xs" data-testid="lead-time-cancel-table">
                <thead>
                  <tr className="border-b">
                    <Th left>期間</Th>
                    <Th>室数</Th>
                    <Th>CXL率</Th>
                    <Th>ADR</Th>
                    <Th>客単価</Th>
                    <Th>CXL室料</Th>
                    <Th>構成比</Th>
                    <Th>DOR</Th>
                    <Th>平均宿泊数</Th>
                    <Th>前年同月比</Th>
                  </tr>
                </thead>
                <tbody>
                  {cancelData.map((row) => (
                    <tr key={row.window} className="border-b hover:bg-muted/50">
                      <td className="px-2 py-2 font-medium">{row.window}</td>
                      <Td>{formatRooms(row.rooms)}</Td>
                      <Td className={(row.cancelRate ?? 0) > 8 ? "text-negative" : undefined}>{pctText(row.cancelRate)}</Td>
                      <Td>{formatYen(row.adr)}</Td>
                      <Td>{formatYen(row.guestUnitPrice)}</Td>
                      <Td className="font-medium">{formatYen(row.revenue)}</Td>
                      <Td>{pctText(row.share)}</Td>
                      <Td>{numText(row.dor, 2)}</Td>
                      <Td>{numText(row.avgNights, 1, "泊")}</Td>
                      {/* キャンセルは減るほど良いので、増えたら赤 */}
                      <Td className={signClass(row.yoy == null ? null : -row.yoy)}>{formatPt(row.yoy)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-muted-foreground">期間は予約が入った時期です（キャンセルした時期ではありません）。構成比はキャンセル室数に占める割合です。</p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-l-4 border-l-[color:var(--chart-3)]">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">リードタイム分析インサイト</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          <AnalysisInsightsBody period={targetPeriod} pick={(i) => i.leadTime.length}>
            {(insights) =>
              insights.leadTime.map((text) => (
                <div key={text} className="flex items-start gap-3">
                  <div className="mt-2 h-2 w-2 flex-shrink-0 rounded-full bg-[color:var(--chart-3)]" />
                  <p className="text-sm leading-relaxed">{text}</p>
                </div>
              ))
            }
          </AnalysisInsightsBody>
        </CardContent>
      </Card>
    </div>
  )
}
