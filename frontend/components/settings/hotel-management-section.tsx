"use client"

// ホテル管理（管理者 = ADMIN・運営 — #81）
// 自テナントのホテルの一覧・追加・削除（論理削除）。名称・客室数・週末定義などの編集は
// 「ホテル設定」カード（HotelSettingsCard）で、選択中のホテルに対して行う。
// 運営はテナントを越えて見えるため、追加はテナントの管理者に任せ、一覧と削除だけにする。

import { useState } from "react"
import { Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { useAuth } from "@/components/auth-provider"
import { HotelCreateForm, type HotelCreateValues } from "@/components/settings/hotel-create-form"
import { api, ApiClientError, type Hotel } from "@/lib/api"

export function HotelManagementSection() {
  const { user, hotels, hotelId, reloadHotels, selectHotel } = useAuth()
  const canCreate = user?.role === "ADMIN"
  const [createOpen, setCreateOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Hotel | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const handleCreate = async (values: HotelCreateValues) => {
    setSaving(true)
    try {
      const hotel = await api.createHotel({
        name: values.name,
        totalRooms: values.totalRooms,
        address: values.address || undefined,
      })
      toast.success(`「${hotel.name}」を追加しました`)
      setCreateOpen(false)
      await reloadHotels()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "ホテルの追加に失敗しました")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (target: Hotel) => {
    setDeletingId(target.id)
    try {
      await api.deleteHotel(target.id)
      toast.success(`「${target.name}」を削除しました`)
      await reloadHotels()
      // 表示中のホテルを消したら、残っているホテルへ切り替える
      if (target.id === hotelId) {
        const next = hotels.find((h) => h.id !== target.id)
        if (next) selectHotel(next.id)
      }
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "ホテルの削除に失敗しました")
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>ホテル管理</CardTitle>
          <CardDescription>
            {canCreate
              ? "このテナントのホテルを追加・削除します。各ホテルの詳細は上の「ホテル設定」で編集します。"
              : "アクセスできるホテルの一覧です。ホテルの追加は各テナントの管理者が行います。"}
          </CardDescription>
        </div>
        {canCreate && (
          <Button size="sm" className="gap-2" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            ホテルを追加
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {hotels.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{h.name}</span>
                  {h.id === hotelId && <Badge variant="secondary">表示中</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">
                  客室数 {h.totalRooms.toLocaleString()}室{h.address ? ` ・ ${h.address}` : ""}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPendingDelete(h)}
                disabled={deletingId === h.id || hotels.length <= 1}
                title={hotels.length <= 1 ? "最後のホテルは削除できません" : undefined}
                aria-label={`ホテル「${h.name}」を削除`}
              >
                {deletingId === h.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Trash2 className="h-4 w-4 text-muted-foreground" aria-hidden />
                )}
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>ホテルを追加</DialogTitle>
            <DialogDescription>追加したホテルは、ヘッダーのホテル切替から選べるようになります。</DialogDescription>
          </DialogHeader>
          <HotelCreateForm saving={saving} onSubmit={handleCreate} submitLabel="追加する" idPrefix="add-hotel" />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="ホテルを削除しますか？"
        description={
          pendingDelete
            ? `「${pendingDelete.name}」を一覧から削除します。実績などのデータは残りますが、画面からは参照できなくなります。`
            : undefined
        }
        confirmLabel="削除する"
        onConfirm={() => {
          const target = pendingDelete
          setPendingDelete(null)
          if (target) void handleDelete(target)
        }}
      />
    </Card>
  )
}
