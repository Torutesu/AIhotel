"use client"

// 当月のイベント情報（U-3 / U-15 で pricing-tab.tsx から分割）
// GET/POST /events・PUT /events/:id・DELETE /events/:id を扱う自己完結セクション。

import { useCallback, useEffect, useState } from "react"
import { Edit2, Loader2, Plus, Trash2 } from "lucide-react"
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
import { api, ApiClientError, type CreateEventInput } from "@/lib/api"
import type { Event as HotelEvent } from "@shared/types"

interface EventListCardProps {
  /** 表示対象期間（"yyyy-MM-dd"） */
  startDate: string
  endDate: string
}

export function EventListCard({ startDate, endDate }: EventListCardProps) {
  const { hotelId } = useAuth()

  const [events, setEvents] = useState<HotelEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  /** 編集中のイベント（null なら新規登録） */
  const [editingEvent, setEditingEvent] = useState<HotelEvent | null>(null)
  const [saving, setSaving] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<HotelEvent | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!hotelId) return
    setLoading(true)
    setError(null)
    try {
      setEvents(await api.events(hotelId, startDate, endDate))
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "イベント情報の取得に失敗しました")
    } finally {
      setLoading(false)
    }
  }, [hotelId, startDate, endDate])

  useEffect(() => {
    load()
  }, [load])

  const openCreate = () => {
    setEditingEvent(null)
    setDialogOpen(true)
  }

  const openEdit = (ev: HotelEvent) => {
    setEditingEvent(ev)
    setDialogOpen(true)
  }

  /** 新規登録（POST /events）と編集（PUT /events/:id）を同じフォームで処理する（U-3） */
  const handleSubmit = async (values: EventFormValues) => {
    if (!hotelId) return
    setSaving(true)
    try {
      const payload: CreateEventInput = {
        hotelId,
        name: values.name.trim(),
        type: values.type,
        startDate: values.startDate,
        endDate: values.endDate,
        expectedImpact: values.expectedImpact,
        location: values.location.trim() || undefined,
      }
      if (editingEvent) {
        const { hotelId: _hotelId, ...updateInput } = payload
        await api.updateEvent(editingEvent.id, hotelId, updateInput)
        toast.success("イベントを更新しました")
      } else {
        await api.createEvent(payload)
        toast.success("イベントを登録しました")
      }
      setDialogOpen(false)
      setEditingEvent(null)
      await load()
    } catch (err) {
      toast.error(
        err instanceof ApiClientError
          ? err.message
          : editingEvent
            ? "イベントの更新に失敗しました"
            : "イベントの登録に失敗しました",
      )
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
      await load()
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
          <div className="mb-2.5 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">当月のイベント情報</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                近隣イベントは需要予測の参考情報として登録されます
              </p>
            </div>
            <Button variant="outline" size="sm" className="h-8 gap-2 text-xs" onClick={openCreate}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              イベントを追加
            </Button>
          </div>

          {loading ? (
            <Skeleton className="h-16 w-full" />
          ) : error ? (
            <ErrorState message={error} onRetry={load} />
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
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatEventRange(ev.startDate, ev.endDate)}
                      {ev.location ? ` ・ ${ev.location}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEdit(ev)}
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
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* イベント登録・編集ダイアログ（U-3 / U-11） */}
      <EventDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open)
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
