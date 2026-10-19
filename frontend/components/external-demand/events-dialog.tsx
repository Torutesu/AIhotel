"use client"

// 外部需要動向 > イベント（2026-10 の画面修正。PDF 1・2）。
// 登録済みイベントの一覧・CSV 出力・個別の登録・編集・削除・規定フォーム（CSV）での取り込みをまとめた画面。
// ダイナミックプライシングの「当月のイベント情報」にあった「イベントを追加」をここへ移した。
// 権限はバックエンドと同じ: 登録はオペレーターも可、編集・削除・取り込みは MANAGER 以上。

import { useMemo, useState } from "react"
import { Download, Edit2, Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { ErrorState } from "@/components/error-state"
import { useAuth } from "@/components/auth-provider"
import { EventDialog, type EventFormValues } from "@/components/pricing/event-dialog"
import { formatEventRange, impactBadgeClass, impactLabel } from "@/components/pricing/pricing-constants"
import { CsvImportCard } from "@/components/settings/csv-import-card"
import { api, ApiClientError, type CreateEventInput } from "@/lib/api"
import { toDateStr } from "@/lib/date"
import { downloadCsv, fileDateStamp } from "@/lib/csv-export"
import { EVENT_CSV_TEMPLATE, eventTypeLabelOf, eventsToCsvRows, parseEventCsv } from "@/lib/external-demand-csv"
import { canManage, type Event as HotelEvent } from "@shared/types"

/** 今日以降に終わるイベントだけにする（"今後" の表示） */
export function upcomingEvents(events: HotelEvent[], today = toDateStr(new Date())): HotelEvent[] {
  return events.filter((e) => (typeof e.endDate === "string" ? e.endDate : e.endDate.toISOString()).slice(0, 10) >= today)
}

interface EventsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  events: HotelEvent[] | null
  loading: boolean
  error: string | null
  /** 登録・編集・削除・取り込みのあとに一覧を取り直す */
  onReload: () => void | Promise<void>
}

export function EventsDialog({ open, onOpenChange, events, loading, error, onReload }: EventsDialogProps) {
  const { hotelId, user } = useAuth()
  const canEdit = canManage(user?.role)
  const [scope, setScope] = useState<"upcoming" | "all">("upcoming")
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<HotelEvent | null>(null)
  const [saving, setSaving] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<HotelEvent | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const listed = useMemo(() => (events ? (scope === "upcoming" ? upcomingEvents(events) : events) : []), [events, scope])

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
        excludeFromHistory: values.excludeFromHistory,
      }
      if (editing) {
        const { hotelId: _hotelId, ...updateInput } = payload
        await api.updateEvent(editing.id, hotelId, updateInput)
        toast.success("イベントを更新しました")
      } else {
        await api.createEvent(payload)
        toast.success("イベントを登録しました")
      }
      setFormOpen(false)
      setEditing(null)
      await onReload()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : editing ? "イベントの更新に失敗しました" : "イベントの登録に失敗しました")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (event: HotelEvent) => {
    if (!hotelId) return
    setDeletingId(event.id)
    try {
      await api.deleteEvent(event.id, hotelId)
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
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] w-full overflow-y-auto sm:!max-w-[90vw] lg:!max-w-[70vw]">
          <DialogHeader>
            <DialogTitle>イベントの一覧</DialogTitle>
            <DialogDescription>
              近隣のイベントを登録すると、需要予測と料金カレンダーに反映されます。個別に登録するか、規定フォーム（CSV）でまとめて取り込めます。
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-1" role="group" aria-label="表示する期間">
              <Button size="sm" variant={scope === "upcoming" ? "default" : "outline"} aria-pressed={scope === "upcoming"} onClick={() => setScope("upcoming")}>
                今後のイベント
              </Button>
              <Button size="sm" variant={scope === "all" ? "default" : "outline"} aria-pressed={scope === "all"} onClick={() => setScope("all")}>
                すべて
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                className="gap-2"
                disabled={listed.length === 0}
                onClick={() => downloadCsv(`イベント一覧_${fileDateStamp()}.csv`, eventsToCsvRows(listed))}
              >
                <Download className="h-4 w-4" aria-hidden />
                CSV出力
              </Button>
              <Button
                size="sm"
                className="gap-2"
                onClick={() => {
                  setEditing(null)
                  setFormOpen(true)
                }}
              >
                <Plus className="h-4 w-4" aria-hidden />
                イベントを追加
              </Button>
            </div>
          </div>

          {loading ? (
            <Skeleton className="h-32 w-full" />
          ) : error ? (
            <ErrorState message={error} onRetry={onReload} />
          ) : listed.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {scope === "upcoming" ? "今後のイベントは登録されていません。" : "イベントは登録されていません。"}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">期間</th>
                    <th className="py-2 pr-3 font-medium">イベント名</th>
                    <th className="py-2 pr-3 font-medium">種別</th>
                    <th className="py-2 pr-3 font-medium">開催場所</th>
                    <th className="py-2 pr-3 font-medium">影響度</th>
                    <th className="py-2 pr-3 font-medium">特殊日</th>
                    {canEdit && <th className="py-2 font-medium"><span className="sr-only">操作</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {listed.map((ev) => (
                    <tr key={ev.id} className="border-b last:border-0">
                      <td className="whitespace-nowrap py-2 pr-3 tabular-nums">{formatEventRange(ev.startDate, ev.endDate)}</td>
                      <td className="py-2 pr-3 font-medium">{ev.name}</td>
                      <td className="whitespace-nowrap py-2 pr-3 text-xs">{eventTypeLabelOf(ev.type)}</td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">{ev.location || "-"}</td>
                      <td className="py-2 pr-3">
                        {ev.expectedImpact ? (
                          <Badge className={`${impactBadgeClass(ev.expectedImpact)} text-[10px]`}>{impactLabel(ev.expectedImpact)}</Badge>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs">{ev.excludeFromHistory ? "○" : "-"}</td>
                      {canEdit && (
                        <td className="whitespace-nowrap py-1 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`イベント「${ev.name}」を編集`}
                            onClick={() => {
                              setEditing(ev)
                              setFormOpen(true)
                            }}
                          >
                            <Edit2 className="h-4 w-4 text-muted-foreground" aria-hidden />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`イベント「${ev.name}」を削除`}
                            disabled={deletingId === ev.id}
                            onClick={() => setPendingDelete(ev)}
                          >
                            {deletingId === ev.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                            ) : (
                              <Trash2 className="h-4 w-4 text-muted-foreground" aria-hidden />
                            )}
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <CsvImportCard
            title="規定フォームから取り込む"
            description={
              <>
                テンプレート（CSV）にイベントを書いて取り込みます。種別は「コンサート・スポーツ・カンファレンス・祭り・催事・年末年始・大型連休・台風・災害・その他」、
                影響度は「高・中・低」、特殊日は「○」か空欄です。同じイベント名・同じ開始日の行は上書きします。上の「CSV出力」のファイルもそのまま取り込めます。
              </>
            }
            templateFileName="イベント取り込みテンプレート.csv"
            template={EVENT_CSV_TEMPLATE}
            maxRows={500}
            parse={parseEventCsv}
            submit={(id, rows, dryRun) => api.importEvents(id, rows, dryRun)}
            unit="件"
            onImported={() => void onReload()}
          />
        </DialogContent>
      </Dialog>

      <EventDialog
        open={formOpen}
        onOpenChange={(next) => {
          setFormOpen(next)
          if (!next) setEditing(null)
        }}
        event={editing}
        saving={saving}
        onSubmit={handleSubmit}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null)
        }}
        title="イベントを削除しますか？"
        description={pendingDelete ? `「${pendingDelete.name}」を削除します。この操作は取り消せません。` : undefined}
        confirmLabel="削除する"
        destructive
        onConfirm={() => {
          const target = pendingDelete
          setPendingDelete(null)
          if (target) void handleDelete(target)
        }}
      />
    </>
  )
}
