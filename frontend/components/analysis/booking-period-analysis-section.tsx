"use client"

// リードタイム分析（予約期間別。U-15 で analysis-tab.tsx から分割）。
// 予約明細の集計APIが未実装のためサンプル表示。2026-10 PDF c分析03 に合わせて
//  - 期間に 61-90日前・91-120日前・121-180日前 を足す（181日以上前は施設へのヒアリング後）
//  - 予約の表: 販売室数・稼働率・ADR・客単価・室料売上・売上構成比・CXL率・DOR・平均宿泊数・前年同月比
//  - 下に CXL（キャンセル）の表: 室数・CXL率・ADR・客単価・CXL室料・構成比・DOR・平均宿泊数・前年同月比
// 「日のタイプ」の列は 2026-10 xlsx 分析03（その予約期間の時点で対象月の日に最も多かった日のタイプ）。

import { useMemo, type ReactNode } from "react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { SampleDataNotice } from "@/components/sample-data-notice"
import { buildPeriodData } from "@/components/analysis/sample-period-data"
import { DayTypeBadge, DayTypeHelp } from "@/components/pricing/day-type"
import { useTargetPeriod, type AnalysisSectionProps } from "@/components/analysis/section-props"
import { formatPercent, formatPt, formatRooms, formatYen } from "@/lib/format"
import { cn } from "@/lib/utils"

function signClass(value: number): string {
  if (value === 0) return "text-muted-foreground"
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
  const { bookingWindowData, cancelData } = useMemo(() => buildPeriodData(targetPeriod), [targetPeriod])

  return (
    <div className="space-y-4">
      <SampleDataNotice detail="予約期間（リードタイム）別・キャンセルの集計APIが未実装のため、以下の数値はサンプルです。" />
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">リードタイム分析</CardTitle>
          <p className="text-xs text-muted-foreground">
            対象月の予約を、予約が入った時期（宿泊日の何日前か）で分けて集計します。181日以上前の区分は施設へのヒアリング後に追加します。
          </p>
        </CardHeader>
        <CardContent className="space-y-5 pt-0">
          <div className="space-y-1.5">
            <h3 className="text-sm font-medium">予約</h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] whitespace-nowrap text-xs" data-testid="lead-time-booking-table">
                <thead>
                  <tr className="border-b">
                    <Th left>期間</Th>
                    <th className="px-2 py-2 text-center font-medium">
                      <DayTypeHelp />
                    </th>
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
                      <td className="px-2 py-2 text-center">
                        <DayTypeBadge dayType={row.dayType} />
                      </td>
                      <Td>{formatRooms(row.soldRooms)}</Td>
                      <Td>{formatPercent(row.occupancy)}</Td>
                      <Td>{formatYen(row.adr)}</Td>
                      <Td>{formatYen(row.guestUnitPrice)}</Td>
                      <Td className="font-medium">{formatYen(row.revenue)}</Td>
                      <Td>{row.revenueShare.toFixed(1)}%</Td>
                      <Td className={row.cancelRate > 8 ? "text-negative" : undefined}>{row.cancelRate.toFixed(1)}%</Td>
                      <Td>{row.dor.toFixed(2)}</Td>
                      <Td>{row.avgNights.toFixed(1)}泊</Td>
                      <Td className={signClass(row.yoy)}>{formatPt(row.yoy)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-muted-foreground">
              日のタイプは、その予約期間の時点で対象月の日に最も多かった日のタイプ（平日A型など）です。さかのぼって並べると、予約の入り方で型がどう変わったかが分かります。
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
                      <Td className={row.cancelRate > 8 ? "text-negative" : undefined}>{row.cancelRate.toFixed(1)}%</Td>
                      <Td>{formatYen(row.adr)}</Td>
                      <Td>{formatYen(row.guestUnitPrice)}</Td>
                      <Td className="font-medium">{formatYen(row.revenue)}</Td>
                      <Td>{row.share.toFixed(1)}%</Td>
                      <Td>{row.dor.toFixed(2)}</Td>
                      <Td>{row.avgNights.toFixed(1)}泊</Td>
                      {/* キャンセルは減るほど良いので、増えたら赤 */}
                      <Td className={signClass(-row.yoy)}>{formatPt(row.yoy)}</Td>
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
          <SampleDataNotice detail="Claude APIによるAIコメント生成が未実装のため、以下は固定文のサンプルです。" />
          {[
            "8-14日前と15-30日前の予約で販売室数の約4割を占めます。この期間の料金ランクが月の売上に大きく効きます。",
            "61日以上前の予約は前年同月より2割以上増え、ADRも高い水準ですが、CXL率も1割を超えます。早期の予約にはキャンセル規定の見直しを検討してください。",
            "当日〜3日前の直前予約は1名利用が中心で、客単価は低めです。直前の値下げは平日B型の日に絞ると効果的です。",
          ].map((text) => (
            <div key={text} className="flex items-start gap-3">
              <div className="mt-2 h-2 w-2 flex-shrink-0 rounded-full bg-[color:var(--chart-3)]" />
              <p className="text-sm leading-relaxed">{text}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
