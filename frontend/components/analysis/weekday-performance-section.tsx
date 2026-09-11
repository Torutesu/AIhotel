"use client"

// 曜日別パフォーマンス分析（U-15 で daily-analysis-tab.tsx から分割）
// 曜日別・祝日別の集計APIが未実装のためサンプル表示。

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { SampleDataNotice } from "@/components/sample-data-notice"

/** 曜日別パフォーマンス分析（祝日・休前日を別区分で集計） */
export function WeekdayPerformanceSection() {
  return (
    /* Day of Week Analysis */
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">曜日別パフォーマンス分析</CardTitle>
        <p className="text-xs text-muted-foreground">
          祝日・休前日は曜日と別区分で集計しています。GW・年末年始などの特日グループの集計区分は、マスタ設定でのグループ化に対応予定です
        </p>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        <SampleDataNotice detail="曜日別・祝日別の集計APIが未実装のため、以下の数値はサンプルです。" />
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 px-2 font-medium">区分</th>
                <th className="text-right py-2 px-2 font-medium">平均稼働率</th>
                <th className="text-right py-2 px-2 font-medium">平均ADR</th>
                <th className="text-right py-2 px-2 font-medium">平均REV-Per</th>
                <th className="text-right py-2 px-2 font-medium">前年比</th>
              </tr>
            </thead>
            <tbody>
              {[
                { day: "月曜日", occ: 56.7, adr: 15500, revpar: 8807, yoy: -0.1 },
                { day: "火曜日", occ: 71.7, adr: 16900, revpar: 12117, yoy: 4.9 },
                { day: "水曜日", occ: 65.0, adr: 16400, revpar: 10660, yoy: 2.8 },
                { day: "木曜日", occ: 78.4, adr: 17250, revpar: 13517, yoy: 7.7 },
                { day: "金曜日", occ: 91.7, adr: 21000, revpar: 19258, yoy: 11.6 },
                { day: "土曜日", occ: 100.0, adr: 25750, revpar: 25750, yoy: 17.6 },
                { day: "日曜日", occ: 95.0, adr: 23150, revpar: 21993, yoy: 14.4 },
                { day: "祝日", occ: 97.2, adr: 24800, revpar: 24106, yoy: 15.8, isSpecial: true },
                { day: "休前日", occ: 96.5, adr: 24200, revpar: 23353, yoy: 13.9, isSpecial: true },
              ].map((row) => (
                <tr key={row.day} className={`border-b hover:bg-muted/50 ${row.isSpecial ? "bg-warning/5" : ""}`}>
                  <td className={`py-2 px-2 font-medium ${row.isSpecial ? "text-warning" : ""}`}>{row.day}</td>
                  <td className="text-right py-2 px-2">{row.occ.toFixed(1)}%</td>
                  <td className="text-right py-2 px-2">¥{row.adr.toLocaleString()}</td>
                  <td className="text-right py-2 px-2">¥{row.revpar.toLocaleString()}</td>
                  <td className="text-right py-2 px-2">
                    <span className={row.yoy >= 0 ? "text-positive" : "text-negative"}>
                      {row.yoy >= 0 ? "+" : ""}
                      {row.yoy.toFixed(1)}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}