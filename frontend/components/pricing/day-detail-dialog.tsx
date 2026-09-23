"use client"

// 日別の詳細情報ダイアログ（U-15 で pricing-tab.tsx から分割）
// その日の推奨価格・需要予測と、その日にかかる登録済みイベント（GET /events）を表示する。
// 以前は画面内だけに保持する「メモ保存」があり、保存したように見えてリロードで消えていたため廃止した（#80）。
// イベントの登録・編集は「当月のイベント情報」から行う。

import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  demandDescription,
  eventTypeLabel,
  formatEventRange,
  impactBadgeClass,
  impactLabel,
} from "@/components/pricing/pricing-constants"
import { DAY_NAMES } from "@/lib/date"
import { formatPercent as pct, formatYen as yen } from "@/lib/format"
import type { PricingCalendarDay } from "@/lib/api"
import type { Event as HotelEvent } from "@shared/types"

interface DayDetailDialogProps {
  day: PricingCalendarDay | null
  /** その日にかかっている登録済みイベント */
  events: HotelEvent[]
  onClose: () => void
}

export function DayDetailDialog({ day, events, onClose }: DayDetailDialogProps) {
  return (
    <Dialog
      open={day !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        {day &&
          (() => {
            const [y, m, d] = day.date.split("-").map(Number)
            const dow = new Date(day.date).getDay()
            const dateString = `${y}年${m}月${d}日（${DAY_NAMES[dow]}）`

            return (
              <>
                <DialogHeader>
                  <DialogTitle>{dateString} の詳細情報</DialogTitle>
                  <DialogDescription>AIによる推奨価格・需要アラートの詳細です</DialogDescription>
                </DialogHeader>

                <div className="space-y-6 mt-4">
                  <div className="border rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="font-medium">推奨価格（料金ランク {day.rankLabel ?? "-"}）</div>
                      {day.confidence != null && <Badge variant="outline" className="text-xs">信頼度 {(day.confidence * 100).toFixed(0)}%</Badge>}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                      <div>1名料金：{yen(day.price1P)}</div>
                      <div>2名料金：{yen(day.price2P)}</div>
                      <div>3名料金：{yen(day.price3P)}</div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm border-t pt-3">
                      <div>アラート：{day.demandLevel ?? "-"}（{demandDescription(day.demandLevel)}）</div>
                      <div>稼働率予測：{pct(day.predictedOccupancy)}</div>
                      <div>競合価格水準（中央値）：{yen(day.competitorMedianPrice)}</div>
                      <div>AI予測ADR：{yen(day.predictedAdr)}</div>
                      {day.actualAdr != null && <div>実績ADR：{yen(day.actualAdr)}</div>}
                      {day.actualOccupancy != null && <div>実績稼働率：{pct(day.actualOccupancy)}</div>}
                    </div>
                  </div>

                  <div className="space-y-3 border-t pt-4">
                    <h3 className="font-semibold text-base">この日のイベント</h3>
                    {events.length === 0 ? (
                      <p className="text-sm text-muted-foreground">この日にかかる登録済みのイベントはありません。</p>
                    ) : (
                      <ul className="space-y-2">
                        {events.map((ev) => (
                          <li key={ev.id} className="rounded-lg border px-3 py-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium">{ev.name}</span>
                              <Badge variant="outline" className="text-[10px]">
                                {eventTypeLabel(ev.type)}
                              </Badge>
                              {ev.expectedImpact && (
                                <Badge className={`${impactBadgeClass(ev.expectedImpact)} text-[10px]`}>
                                  {impactLabel(ev.expectedImpact)}
                                </Badge>
                              )}
                            </div>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {formatEventRange(ev.startDate, ev.endDate)}
                              {ev.location ? ` ・ ${ev.location}` : ""}
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="text-xs text-muted-foreground">
                      イベントの登録・編集は、画面下の「当月のイベント情報」から行えます。登録したイベントは需要予測に反映されます。
                    </p>
                  </div>
                </div>
              </>
            )
          })()}
      </DialogContent>
    </Dialog>
  )
}
