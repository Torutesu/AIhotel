"use client"

// 当月のイベント情報（U-3 / U-15 で pricing-tab.tsx から分割）。
// 一覧（GET /events）は親（プライシングタブ）が読み込み、カレンダー・日別詳細と共有する（#80）。
// 2026-10 の画面修正（PDF 2）で、登録・編集・取り込みは「外部需要動向」のイベントへ移した。ここは参照だけ。

import { ArrowRight } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/error-state"
import {
  eventTypeLabel,
  formatEventRange,
  impactBadgeClass,
  impactLabel,
} from "@/components/pricing/pricing-constants"
import type { Event as HotelEvent } from "@shared/types"

interface EventListCardProps {
  events: HotelEvent[]
  loading: boolean
  error: string | null
  /** 一覧の再取得（エラー時の再試行） */
  onReload: () => void | Promise<void>
  /** 「外部需要動向」のイベントへ移動する（登録・取り込みはそちらで行う） */
  onManage?: () => void
}

export function EventListCard({ events, loading, error, onReload, onManage }: EventListCardProps) {
  return (
    <Card>
      <CardContent className="px-3 py-2.5">
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-lg font-semibold">当月のイベント情報</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              近隣イベントは需要予測の参考情報です。登録・編集・規定フォームでの取り込みは「外部需要動向」のイベントから行います
            </p>
          </div>
          {onManage && (
            <Button variant="outline" size="sm" className="h-8 gap-2 text-xs" onClick={onManage}>
              外部需要動向で登録・取り込み
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Button>
          )}
        </div>

        {loading ? (
          <Skeleton className="h-16 w-full" />
        ) : error ? (
          <ErrorState message={error} onRetry={onReload} />
        ) : events.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">この期間のイベント情報は登録されていません。</p>
        ) : (
          <div className="space-y-2">
            {events.map((ev) => (
              <div key={ev.id} className="rounded-lg border px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{ev.name}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {eventTypeLabel(ev.type)}
                  </Badge>
                  {ev.expectedImpact && (
                    <Badge className={`${impactBadgeClass(ev.expectedImpact)} text-[10px]`}>{impactLabel(ev.expectedImpact)}</Badge>
                  )}
                  {ev.excludeFromHistory && (
                    <Badge variant="secondary" className="text-[10px]" title="期間内の実績を予測の基準に使いません">
                      特殊日
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatEventRange(ev.startDate, ev.endDate)}
                  {ev.location ? ` ・ ${ev.location}` : ""}
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
