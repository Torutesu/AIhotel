"use client"

// 当月のイベント情報（U-3 / U-15 で pricing-tab.tsx から分割）
// PUT /events/:id・DELETE /events/:id を扱う。
// 一覧（GET /events）は親（プライシングタブ）が読み込み、カレンダー・日別詳細と共有する（#80）。
// 2026-10 の画面修正（PDF 2）で「イベントを追加」は外部需要動向のイベントへ移し（規定フォームの取り込みもそちら）、
// ここには外部需要動向へ移るボタンを置く。編集・削除はこれまでどおりここからもできる。

import { useState } from "react"
import { ArrowRight, Edit2, Loader2, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { ErrorState } from "@/components/error-state"
import { useAuth } from "@/components/auth-provider"
import { EventDialog, type EventFormValues } from "@/components/pricing/event-dialog"
import {
  eventTypeLabel,
  formatEventRange,
  impactBadgeClass,
  impactLabel,
} from "@/components/pricing/pricing-constants"
import { api, ApiClientError, type UpdateEventInput } from "@/lib/api"
import { canManage, type Event as HotelEvent } from "@shared/types"

interface EventListCardProps {
  events: HotelEvent[]
  loading: boolean
  error: string | null
  /** 一覧の再取得（更新・削除の後、エラー時の再試行） */
  onReload: () => void | Promise<void>
  /** 「外部需要動向」のイベントへ移動する（登録・取り込みはそちらで行う） */
  onManage?: () => void
}

export function EventListCard({ events, loading, error, onReload, onManage }: EventListCardProps) {
  const { hotelId, user } = useAuth()
  // 編集・削除は MANAGER 以上（バックエンドの PUT/DELETE /events と同じ — S-4）
  const canEdit = canManage(user?.role)

  /** 編集中のイベント（null ならダイアログを閉じている） */
  const [editingEvent, setEditingEvent] = useState<HotelEvent | null>(null)
  const [saving, setSaving] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<HotelEvent | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  /** 編集（PUT /events/:id — U-3） */
  const handleSubmit = async (values: EventFormValues) => {
    if (!hotelId || !editingEvent) return
    setSaving(true)
    try {
      const input: UpdateEventInput = {
        name: values.name.trim(),
        type: values.type,
        startDate: values.startDate,
        endDate: values.endDate,
        expectedImpact: values.expectedImpact,
        location: values.location.trim() || undefined,
        excludeFromHistory: values.excludeFromHistory,
      }
      await api.updateEvent(editingEvent.id, hotelId, input)
      toast.success("イベントを更新しました")
      setEditingEvent(null)
      await onReload()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "イベントの更新に失敗しました")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!hotelId) return
    setDeletingId(id)
    try {
      await api.deleteEvent(id, hotelId)
      toast.success("イベントを削除しました")
      await onReload()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "イベントの削除に失敗しました")
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <>
      <Card>
        <CardContent className="px-3 py-2.5">
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-lg font-semibold">当月のイベント情報</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                近隣イベントは需要予測の参考情報です。登録と規定フォームでの取り込みは「外部需要動向」のイベントから行います
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
            <p className="py-4 text-center text-sm text-muted-foreground">
              この期間のイベント情報は登録されていません。
            </p>
          ) : (
            <div className="space-y-2">
              {events.map((ev) => (
                <div
                  key={ev.id}
                  className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                >
                  <div className="min-w-0">
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
                  {canEdit && (
                    <div className="flex flex-shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingEvent(ev)}
                        aria-label={`イベント「${ev.name}」を編集`}
                      >
                        <Edit2 className="h-4 w-4 text-muted-foreground" aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPendingDelete(ev)}
                        disabled={deletingId === ev.id}
                        aria-label={`イベント「${ev.name}」を削除`}
                      >
                        {deletingId === ev.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        ) : (
                          <Trash2 className="h-4 w-4 text-muted-foreground" aria-hidden />
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* イベント編集ダイアログ（U-3 / U-11） */}
      <EventDialog
        open={editingEvent !== null}
        onOpenChange={(open) => {
          if (!open) setEditingEvent(null)
        }}
        event={editingEvent}
        saving={saving}
        onSubmit={handleSubmit}
      />

      {/* イベント削除の確認（F-5） */}
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title="イベントを削除しますか？"
        description={
          pendingDelete
            ? `「${pendingDelete.name}」を削除します。この操作は取り消せません。`
            : undefined
        }
        confirmLabel="削除する"
        onConfirm={() => {
          const target = pendingDelete
          setPendingDelete(null)
          if (target) void handleDelete(target.id)
        }}
      />
    </>
  )
}
