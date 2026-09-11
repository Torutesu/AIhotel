"use client"

// 部屋タイプ別分析（U-15 で analysis-tab.tsx から分割）。集計APIが未実装のためサンプル表示。

import { useMemo } from "react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { SampleDataNotice } from "@/components/sample-data-notice"
import { buildPeriodData } from "@/components/analysis/sample-period-data"
import { useTargetPeriod, type AnalysisSectionProps } from "@/components/analysis/section-props"

export function RoomTypeAnalysisSection(props: AnalysisSectionProps) {
  const { targetPeriod } = useTargetPeriod(props)
  const periodData = useMemo(() => buildPeriodData(targetPeriod), [targetPeriod])

  return (
    <div className="space-y-4">
      <SampleDataNotice detail="部屋タイプ別実績の集計APIが未実装のため、以下の数値はサンプルです。" />
      {/* AI解説を一番上に */}
      <Card className="bg-[color:var(--sky-wash)]/25 border-[color:var(--cyan-edge)]/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <span className="text-xl" aria-hidden>
              🤖
            </span>
            部屋タイプ分析インサイト
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-2 text-sm leading-relaxed">
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 rounded-full bg-[color:var(--positive)] mt-2 flex-shrink-0" />
              <p>
                デラックス以上の客室は稼働率91%超と非常に高く、需要が供給を上回っています。価格引き上げの余地があります。
              </p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 rounded-full bg-[color:var(--chart-2)] mt-2 flex-shrink-0" />
              <p>
                スタンダードシングルの稼働率が82.4%とやや低めです。ビジネス客向けプロモーションの強化を推奨します。
              </p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 rounded-full bg-[color:var(--positive)] mt-2 flex-shrink-0" />
              <p>
                プレミアムスイートのREV-Perが¥61,948と最も高く、収益性の高い客室タイプです。
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">部屋タイプ別パフォーマンス</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 font-medium">部屋タイプ</th>
                  <th className="text-right py-3 px-4 font-medium">客室数</th>
                  <th className="text-right py-3 px-4 font-medium">販売室数</th>
                  <th className="text-right py-3 px-4 font-medium">稼働率</th>
                  <th className="text-right py-3 px-4 font-medium">ADR</th>
                  <th className="text-right py-3 px-4 font-medium">REV-Per</th>
                  <th className="text-right py-3 px-4 font-medium">売上構成比</th>
                </tr>
              </thead>
              <tbody>
                {periodData.roomTypeData.map((row) => (
                  <tr key={row.type} className="border-b hover:bg-muted/50">
                    <td className="py-3 px-4 font-medium">{row.type}</td>
                    <td className="text-right py-3 px-4">{row.rooms}室</td>
                    <td className="text-right py-3 px-4">{row.sold}室</td>
                    <td className="text-right py-3 px-4">
                      <span
                        className={
                          row.occ >= 90
                            ? "text-[color:var(--positive)] font-medium"
                            : row.occ < 80
                              ? "text-[color:var(--negative)]"
                              : ""
                        }
                      >
                        {row.occ.toFixed(1)}%
                      </span>
                    </td>
                    <td className="text-right py-3 px-4">¥{row.adr.toLocaleString()}</td>
                    <td className="text-right py-3 px-4 font-medium">¥{row.revpar.toLocaleString()}</td>
                    <td className="text-right py-3 px-4">{row.share.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
