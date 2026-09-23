"use client"

// 部屋タイプ（#81 / GET・POST・PUT・DELETE /settings/room-types）
// 部屋タイプ別の実績・推奨価格の前提となるマスタ。登録・編集・削除は MANAGER 以上。

import { useCallback, useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { Edit2, Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { z } from "zod"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { ErrorState } from "@/components/error-state"
import { FormFieldError } from "@/components/form-field-error"
import { useAuth } from "@/components/auth-provider"
import { api, ApiClientError, type RoomType } from "@/lib/api"
import { zodResolver } from "@/lib/zod-resolver"
import { ROLE_LABELS, canManage } from "@shared/types"

/** backend の createRoomTypeSchema と同じ制約 */
const roomTypeFormSchema = z.object({
  name: z.string().trim().min(1, "部屋タイプ名を入力してください").max(100),
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,30}$/, "英数字・ハイフン・アンダースコアの30文字以内で入力してください"),
  capacity: z.coerce.number().int("整数で入力してください").min(1, "1以上で入力してください").max(20, "20以下で入力してください"),
  count: z.coerce.number().int("整数で入力してください").min(1, "1以上で入力してください").max(10000),
})
type RoomTypeFormValues = z.infer<typeof roomTypeFormSchema>

export function RoomTypeSection() {
  const { hotelId, user } = useAuth()
  const editable = canManage(user?.role)

  const [roomTypes, setRoomTypes] = useState<RoomType[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<RoomType | null>(null)
  const [saving, setSaving] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<RoomType | null>(null)

  const load = useCallback(async () => {
    if (!hotelId) return
    setLoading(true)
    setError(null)
    try {
      setRoomTypes(await api.roomTypes(hotelId))
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "部屋タイプの取得に失敗しました")
    } finally {
      setLoading(false)
    }
  }, [hotelId])

  useEffect(() => {
    load()
  }, [load])

  const form = useForm<RoomTypeFormValues>({
    resolver: zodResolver(roomTypeFormSchema),
    mode: "onBlur",
  })

  const openDialog = (target: RoomType | null) => {
    setEditing(target)
    form.reset(
      target
        ? { name: target.name, code: target.code, capacity: target.capacity, count: target.count }
        : { name: "", code: "", capacity: 2, count: 1 },
    )
    setDialogOpen(true)
  }

  const handleSubmit = async (values: RoomTypeFormValues) => {
    if (!hotelId) return
    setSaving(true)
    try {
      if (editing) {
        await api.updateRoomType(editing.id, hotelId, values)
        toast.success("部屋タイプを更新しました")
      } else {
        await api.createRoomType(hotelId, values)
        toast.success("部屋タイプを登録しました")
      }
      setDialogOpen(false)
      await load()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "部屋タイプの保存に失敗しました")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (target: RoomType) => {
    if (!hotelId) return
    try {
      await api.deleteRoomType(target.id, hotelId)
      toast.success(`「${target.name}」を削除しました`)
      await load()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "部屋タイプの削除に失敗しました")
    }
  }

  const totalCount = roomTypes.reduce((sum, t) => sum + t.count, 0)

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>部屋タイプ</CardTitle>
          <CardDescription>
            部屋タイプ別の実績・料金の前提になります。
            {editable ? "" : `登録・変更は${ROLE_LABELS.MANAGER}以上のユーザーに依頼してください。`}
          </CardDescription>
        </div>
        {editable && (
          <Button size="sm" className="gap-2" onClick={() => openDialog(null)}>
            <Plus className="h-4 w-4" aria-hidden />
            部屋タイプを追加
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-20 w-full" />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : roomTypes.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">部屋タイプはまだ登録されていません。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">名称</th>
                  <th className="py-2 pr-3 font-medium">コード</th>
                  <th className="py-2 pr-3 text-right font-medium">定員</th>
                  <th className="py-2 pr-3 text-right font-medium">室数</th>
                  {editable && <th className="py-2" />}
                </tr>
              </thead>
              <tbody>
                {roomTypes.map((t) => (
                  <tr key={t.id} className="border-b last:border-0">
                    <td className="py-2 pr-3">{t.name}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{t.code}</td>
                    <td className="py-2 pr-3 text-right">{t.capacity}名</td>
                    <td className="py-2 pr-3 text-right">{t.count.toLocaleString()}室</td>
                    {editable && (
                      <td className="py-2 text-right">
                        <Button variant="ghost" size="sm" onClick={() => openDialog(t)} aria-label={`部屋タイプ「${t.name}」を編集`}>
                          <Edit2 className="h-4 w-4 text-muted-foreground" aria-hidden />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setPendingDelete(t)} aria-label={`部屋タイプ「${t.name}」を削除`}>
                          <Trash2 className="h-4 w-4 text-muted-foreground" aria-hidden />
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted-foreground">室数の合計: {totalCount.toLocaleString()}室</p>
          </div>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{editing ? "部屋タイプを編集" : "部屋タイプを追加"}</DialogTitle>
            <DialogDescription>コードは PMS の部屋タイプコードと揃えると、連携時に突き合わせられます。</DialogDescription>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(handleSubmit)} noValidate className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="room-type-name">名称</Label>
              <Input id="room-type-name" placeholder="例: スタンダードツイン" {...form.register("name")} />
              <FormFieldError message={form.formState.errors.name?.message} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="room-type-code">コード</Label>
              <Input id="room-type-code" placeholder="例: STD_TWIN" {...form.register("code")} />
              <FormFieldError message={form.formState.errors.code?.message} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="room-type-capacity">定員（名）</Label>
                <Input id="room-type-capacity" type="number" min={1} {...form.register("capacity")} />
                <FormFieldError message={form.formState.errors.capacity?.message} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="room-type-count">室数</Label>
                <Input id="room-type-count" type="number" min={1} {...form.register("count")} />
                <FormFieldError message={form.formState.errors.count?.message} />
              </div>
            </div>
            <Button type="submit" disabled={saving} className="gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {editing ? "更新する" : "追加する"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="部屋タイプを削除しますか？"
        description={pendingDelete ? `「${pendingDelete.name}」を削除します。同じコードで登録し直すと復元されます。` : undefined}
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
