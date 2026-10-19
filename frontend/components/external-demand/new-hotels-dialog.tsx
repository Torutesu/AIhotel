"use client"

// 外部需要動向 > 新規ホテル（2026-10 の画面修正。PDF 1）。
// 周辺の新規ホテルの一覧・CSV 出力・個別の登録・編集・削除・規定フォーム（CSV）での取り込み。
// 変更は MANAGER 以上（バックエンドの /new-hotels と同じ）。オペレーターは一覧と CSV 出力だけ。

import { useState } from "react"
import { Download, Edit2, Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { ErrorState } from "@/components/error-state"
import { useAuth } from "@/components/auth-provider"
import { impactBadgeClass, impactLabel } from "@/components/pricing/pricing-constants"
import { CsvImportCard } from "@/components/settings/csv-import-card"
import { api, ApiClientError, type NewHotelInput, type NewHotelOpening } from "@/lib/api"
import { downloadCsv, fileDateStamp } from "@/lib/csv-export"
import { NEW_HOTEL_CSV_TEMPLATE, newHotelsToCsvRows, parseNewHotelCsv } from "@/lib/external-demand-csv"
import { canManage, ROLE_LABELS } from "@shared/types"
import { NewHotelFormDialog } from "./new-hotel-form-dialog"

interface NewHotelsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  hotels: NewHotelOpening[] | null
  loading: boolean
  error: string | null
  onReload: () => void | Promise<void>
}

export function NewHotelsDialog({ open, onOpenChange, hotels, loading, error, onReload }: NewHotelsDialogProps) {
  const { hotelId, user } = useAuth()
  const canEdit = canManage(user?.role)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<NewHotelOpening | null>(null)
  const [saving, setSaving] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<NewHotelOpening | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const list = hotels ?? []
  const totalRooms = list.reduce((sum, h) => sum + (h.rooms ?? 0), 0)

  const handleSubmit = async (input: NewHotelInput) => {
    if (!hotelId) return
    setSaving(true)
    try {
      if (editing) {
        await api.updateNewHotel(hotelId, editing.id, input)
        toast.success("新規ホテルを更新しました")
      } else {
        await api.createNewHotel(hotelId, input)
        toast.success("新規ホテルを登録しました")
      }
      setFormOpen(false)
      setEditing(null)
      await onReload()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "新規ホテルの保存に失敗しました")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (hotel: NewHotelOpening) => {
    if (!hotelId) return
    setDeletingId(hotel.id)
    try {
      await api.deleteNewHotel(hotelId, hotel.id)
      toast.success("新規ホテルを削除しました")
      await onReload()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "新規ホテルの削除に失敗しました")
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] w-full overflow-y-auto sm:!max-w-[90vw] lg:!max-w-[70vw]">
          <DialogHeader>
            <DialogTitle>新規ホテルの一覧</DialogTitle>
            <DialogDescription>
              周辺で開業する（した）ホテルです。個別に登録するか、規定フォーム（CSV）でまとめて取り込めます。
              {list.length > 0 && ` 登録 ${list.length}軒・客室数の合計 ${totalRooms.toLocaleString()}室`}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-2"
              disabled={list.length === 0}
              onClick={() => downloadCsv(`新規ホテル一覧_${fileDateStamp()}.csv`, newHotelsToCsvRows(list))}
            >
              <Download className="h-4 w-4" aria-hidden />
              CSV出力
            </Button>
            {canEdit ? (
              <Button
                size="sm"
                className="gap-2"
                onClick={() => {
                  setEditing(null)
                  setFormOpen(true)
                }}
              >
                <Plus className="h-4 w-4" aria-hidden />
                新規ホテルを追加
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">登録・編集は{ROLE_LABELS.MANAGER}以上のユーザーが行えます。</span>
            )}
          </div>

          {loading ? (
            <Skeleton className="h-32 w-full" />
          ) : error ? (
            <ErrorState message={error} onRetry={onReload} />
          ) : list.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">新規ホテルは登録されていません。</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">開業日</th>
                    <th className="py-2 pr-3 font-medium">ホテル名</th>
                    <th className="py-2 pr-3 text-right font-medium">客室数</th>
                    <th className="py-2 pr-3 font-medium">カテゴリ</th>
                    <th className="py-2 pr-3 font-medium">所在地</th>
                    <th className="py-2 pr-3 text-right font-medium">距離</th>
                    <th className="py-2 pr-3 font-medium">影響度</th>
                    <th className="py-2 pr-3 font-medium">メモ</th>
                    {canEdit && <th className="py-2 font-medium"><span className="sr-only">操作</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {list.map((h) => (
                    <tr key={h.id} className="border-b align-top last:border-0">
                      <td className="whitespace-nowrap py-2 pr-3 tabular-nums">{h.openingDate.slice(0, 10).replace(/-/g, "/")}</td>
                      <td className="py-2 pr-3 font-medium">{h.name}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{h.rooms != null ? `${h.rooms.toLocaleString()}室` : "-"}</td>
                      <td className="py-2 pr-3 text-xs">{h.category || "-"}</td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">{h.location || "-"}</td>
                      <td className="py-2 pr-3 text-right text-xs tabular-nums">{h.distanceKm != null ? `${h.distanceKm}km` : "-"}</td>
                      <td className="py-2 pr-3">
                        {h.expectedImpact ? <Badge className={`${impactBadgeClass(h.expectedImpact)} text-[10px]`}>{impactLabel(h.expectedImpact)}</Badge> : "-"}
                      </td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">{h.notes || "-"}</td>
                      {canEdit && (
                        <td className="whitespace-nowrap py-1 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`新規ホテル「${h.name}」を編集`}
                            onClick={() => {
                              setEditing(h)
                              setFormOpen(true)
                            }}
                          >
                            <Edit2 className="h-4 w-4 text-muted-foreground" aria-hidden />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`新規ホテル「${h.name}」を削除`}
                            disabled={deletingId === h.id}
                            onClick={() => setPendingDelete(h)}
                          >
                            {deletingId === h.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4 text-muted-foreground" aria-hidden />}
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
                テンプレート（CSV）に新規ホテルを書いて取り込みます。必須はホテル名と開業日で、影響度は「高・中・低」です。
                同じホテル名・同じ開業日の行は上書きします。上の「CSV出力」のファイルもそのまま取り込めます。
              </>
            }
            templateFileName="新規ホテル取り込みテンプレート.csv"
            template={NEW_HOTEL_CSV_TEMPLATE}
            maxRows={500}
            parse={parseNewHotelCsv}
            submit={(id, rows, dryRun) => api.importNewHotels(id, rows, dryRun)}
            unit="件"
            onImported={() => void onReload()}
          />
        </DialogContent>
      </Dialog>

      <NewHotelFormDialog
        open={formOpen}
        onOpenChange={(next) => {
          setFormOpen(next)
          if (!next) setEditing(null)
        }}
        hotel={editing}
        saving={saving}
        onSubmit={handleSubmit}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null)
        }}
        title="新規ホテルを削除しますか？"
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
