"use client"

// 故障部屋設定カード（設定タブ）
// 期間・室数を登録すると、該当期間の販売可能室数（＝稼働率の分母）から差し引かれる。

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import { AlertCircle, Loader2, Plus, RefreshCw, Trash2, Wrench } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { api, ApiClientError, type OutOfOrderRoom } from "@/lib/api"

export function OutOfOrderCard({ hotelId, canManage }: { hotelId: string | null; canManage: boolean }) {
  const { toast } = useToast()

  const [records, setRecords] = useState<OutOfOrderRoom[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [rooms, setRooms] = useState(1)
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!hotelId) return
    setLoading(true)
    setError(null)
    try {
      setRecords(await api.outOfOrderRooms(hotelId))
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "故障部屋設定の取得に失敗しました")
    } finally {
      setLoading(false)
    }
  }, [hotelId])

  useEffect(() => {
    load()
  }, [load])

  const handleCreate = async () => {
    if (!hotelId || !startDate || !endDate) return
    setSaving(true)
    try {
      await api.createOutOfOrderRoom({
        hotelId,
        startDate,
        endDate,
        rooms,
        ...(reason.trim() && { reason: reason.trim() }),
      })
      toast({ title: "故障部屋を登録しました" })
      setStartDate("")
      setEndDate("")
      setRooms(1)
      setReason("")
      load()
    } catch (err) {
      toast({
        variant: "destructive",
        title: "登録に失敗しました",
        description: err instanceof ApiClientError ? err.message : undefined,
      })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!hotelId) return
    setDeletingId(id)
    try {
      await api.deleteOutOfOrderRoom(id, hotelId)
      toast({ title: "故障部屋設定を削除しました" })
      load()
    } catch (err) {
      toast({
        variant: "destructive",
        title: "削除に失敗しました",
        description: err instanceof ApiClientError ? err.message : undefined,
      })
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wrench className="w-5 h-5" />
          故障部屋設定
        </CardTitle>
        <CardDescription>
          修繕等で販売できない部屋を期間指定で登録します。期間中は販売可能室数（稼働率の分母）から差し引かれます
          {!canManage && "（登録・削除にはMANAGER以上の権限が必要です）"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
          <div className="space-y-2">
            <Label htmlFor="ooo-start">開始日</Label>
            <Input
              id="ooo-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              disabled={!canManage}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ooo-end">終了日</Label>
            <Input
              id="ooo-end"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              disabled={!canManage}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ooo-rooms">室数</Label>
            <Input
              id="ooo-rooms"
              type="number"
              min={1}
              value={rooms}
              onChange={(e) => setRooms(Math.max(1, Number.parseInt(e.target.value) || 1))}
              disabled={!canManage}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ooo-reason">理由（任意）</Label>
            <Input
              id="ooo-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="空調修繕 等"
              disabled={!canManage}
            />
          </div>
          <Button
            className="gap-2"
            onClick={handleCreate}
            disabled={!canManage || !startDate || !endDate || saving || !hotelId}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            登録
          </Button>
        </div>

        <Separator />

        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : error ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <AlertCircle className="w-6 h-6 text-destructive" />
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" onClick={load} className="gap-2">
              <RefreshCw className="w-4 h-4" />
              再試行
            </Button>
          </div>
        ) : records.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">故障部屋の登録はありません。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-3 font-medium">期間</th>
                  <th className="text-right py-2 px-3 font-medium">室数</th>
                  <th className="text-left py-2 px-3 font-medium">部屋タイプ</th>
                  <th className="text-left py-2 px-3 font-medium">理由</th>
                  <th className="text-center py-2 px-3 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id} className="border-b hover:bg-muted/50">
                    <td className="py-2 px-3 whitespace-nowrap">
                      {r.startDate.slice(0, 10)} 〜 {r.endDate.slice(0, 10)}
                    </td>
                    <td className="text-right py-2 px-3">{r.rooms}室</td>
                    <td className="py-2 px-3">{r.roomType?.name ?? "ホテル全体"}</td>
                    <td className="py-2 px-3">{r.reason ?? "-"}</td>
                    <td className="text-center py-2 px-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!canManage || deletingId === r.id}
                        onClick={() => handleDelete(r.id)}
                      >
                        {deletingId === r.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
