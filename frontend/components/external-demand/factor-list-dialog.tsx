"use client"

// 外部要因の一覧（気候要因・インバウンド動向・アクセスなど — 2026-10 の画面修正）。
// 要因のケースが増えても見られるよう、カードをクリックすると全件を表で開き、CSV に書き出せる。
// 外部要因データの取り込みは未実装のため、表の中身はサンプル。

import { Download } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { SampleDataNotice } from "@/components/sample-data-notice"
import { downloadCsv, fileDateStamp } from "@/lib/csv-export"
import { FACTOR_STATUS_LABELS, FACTOR_TREND_LABELS, factorsToCsvRows, type ExternalFactorRow } from "./factors"

interface FactorListDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  category: string
  factors: ExternalFactorRow[]
}

export function FactorListDialog({ open, onOpenChange, category, factors }: FactorListDialogProps) {
  const kpiCount = factors.reduce((sum, f) => sum + (f.kpis?.length ?? 0), 0)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-full overflow-y-auto sm:!max-w-[90vw] lg:!max-w-[70vw]">
        <DialogHeader>
          <DialogTitle>{category}の一覧</DialogTitle>
          <DialogDescription>
            {factors.length}項目・指標{kpiCount}件。CSV に書き出して社内の資料やほかのツールで使えます。
          </DialogDescription>
        </DialogHeader>
        <SampleDataNotice detail="外部要因データの取り込みが未実装のため、一覧の内容はサンプルです。" />
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => downloadCsv(`外部需要動向_${category}_${fileDateStamp()}.csv`, factorsToCsvRows(category, factors))}
          >
            <Download className="h-4 w-4" aria-hidden />
            CSV出力
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium">項目</th>
                <th className="py-2 pr-3 font-medium">状況</th>
                <th className="py-2 pr-3 font-medium">傾向</th>
                <th className="py-2 pr-3 font-medium">内容</th>
                <th className="py-2 font-medium">指標</th>
              </tr>
            </thead>
            <tbody>
              {factors.map((f) => (
                <tr key={f.name} className="border-b align-top last:border-0">
                  <td className="whitespace-nowrap py-2 pr-3 font-medium">{f.name}</td>
                  <td className="py-2 pr-3">
                    <Badge variant={f.status === "normal" ? "secondary" : "outline"} className="whitespace-nowrap text-[11px]">
                      {FACTOR_STATUS_LABELS[f.status] ?? f.status}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3 text-xs">{FACTOR_TREND_LABELS[f.trend] ?? f.trend}</td>
                  <td className="py-2 pr-3 text-xs leading-relaxed text-muted-foreground">{f.note}</td>
                  <td className="py-2 text-xs">
                    {f.kpis && f.kpis.length > 0 ? (
                      <dl className="space-y-1">
                        {f.kpis.map((k) => (
                          <div key={k.label} className="flex flex-wrap gap-x-2">
                            <dt className="text-muted-foreground">{k.label}</dt>
                            <dd className="font-semibold tabular-nums">{k.value}</dd>
                            {k.hint && <span className="text-[10px] text-muted-foreground">（{k.hint}）</span>}
                          </div>
                        ))}
                      </dl>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  )
}
