"use client"

// 競合ホテル設定（X-2 / N-2 / F-SET-03）
// 一覧（GET）・追加（POST）・編集（PUT）・削除（DELETE・論理削除）。
// 登録できるのは最大5件で、上限に達したら追加ボタンを無効化して理由を表示する。

import { useCallback, useEffect, useState } from "react"
import { Edit2, ExternalLink, Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { ErrorState } from "@/components/error-state"
import { useAuth } from "@/components/auth-provider"
import {
  CompetitorDialog,
  OTA_FIELDS,
  toOtaUrls,
  type CompetitorFormValues,
} from "@/components/settings/competitor-dialog"
import { api, ApiClientError, type CompetitorSetting } from "@/lib/api"
import { MAX_COMPETITORS_PER_HOTEL } from "@shared/types"

const LIMIT_REASON = `競合ホテルは最大${MAX_COMPETITORS_PER_HOTEL}件までです。不要な競合を削除してから追加してください`

export function CompetitorSection() {
  const { hotelId, user } = useAuth()
  const canManage = user?.role === "ADMIN" || user?.role === "MANAGER"

  const [competitors, setCompetitors] = useState<CompetitorSetting[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  /** 編集対象。null なら新規追加 */
  const [editing, setEditing] = useState<CompetitorSetting | null>(null)
  const [pendingDelete, setPendingDelete] = useState<CompetitorSetting | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!hotelId) return
    setLoading(true)
    setError(null)
    try {
      setCompetitors(await api.competitorSettings(hotelId))
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "競合ホテルの取得に失敗しました")
    } finally {
      setLoading(false)
    }
  }, [hotelId])

  useEffect(() => {
    load()
  }, [load])

  const atLimit = competitors.length >= MAX_COMPETITORS_PER_HOTEL

  const openCreate = () => {
    setEditing(null)
    setDialogOpen(true)
  }

  const openEdit = (competitor: CompetitorSetting) => {
    setEditing(competitor)
    setDialogOpen(true)
  }

  const handleSubmit = async (values: CompetitorFormValues) => {
    if (!hotelId) return
    setSaving(true)
    try {
      const payload = {
        name: values.name.trim(),
        category: values.category.trim() === "" ? null : values.category.trim(),
        address: values.address.trim() === "" ? null : values.address.trim(),
        otaUrls: toOtaUrls(values),
      }
      if (editing) {
        await api.updateCompetitor(editing.id, hotelId, payload)
        toast.success("競合ホテルを更新しました")
      } else {
        await api.createCompetitor({ hotelId, ...payload })
        toast.success("競合ホテルを追加しました")
      }
      setDialogOpen(false)
      setEditing(null)
      await load()
    } catch (err) {
      // 上限超過（400）などバックエンドのメッセージはそのまま見せる
      toast.error(err instanceof ApiClientError ? err.message : "競合ホテルの保存に失敗しました")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (competitor: CompetitorSetting) => {
    if (!hotelId) return
    setDeletingId(competitor.id)
    try {
      await api.deleteCompetitor(competitor.id, hotelId)
      toast.success("競合ホテルを削除しました")
      await load()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "競合ホテルの削除に失敗しました")
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>競合ホテル</CardTitle>
            <CardDescription>
              価格比較の対象となる競合ホテルを最大{MAX_COMPETITORS_PER_HOTEL}件まで登録します（現在{" "}
              {competitors.length} 件）
              {!canManage && "（編集にはMANAGER以上の権限が必要です）"}
            </CardDescription>
          </div>
          {canManage && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={openCreate}
              disabled={atLimit || loading}
              title={atLimit ? LIMIT_REASON : undefined}
            >
              <Plus className="h-4 w-4" aria-hidden />
              競合を追加
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {canManage && atLimit && !loading && (
          <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
            {LIMIT_REASON}
          </p>
        )}

        {loading ? (
          <Skeleton className="h-48 w-full" />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : competitors.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            競合ホテルが登録されていません。
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-3 py-2 text-left font-medium">競合ホテル名</th>
                  <th className="px-3 py-2 text-left font-medium">カテゴリ</th>
                  <th className="px-3 py-2 text-left font-medium">住所</th>
                  <th className="px-3 py-2 text-left font-medium">OTA別URL</th>
                  <th className="px-3 py-2 text-center font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {competitors.map((competitor) => {
                  const links = OTA_FIELDS.filter((f) => competitor.otaUrls?.[f.key])
                  return (
                    <tr key={competitor.id} className="border-b align-top hover:bg-muted/50">
                      <td className="px-3 py-2 font-medium">{competitor.name}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {competitor.category ?? "-"}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {competitor.address ?? "-"}
                      </td>
                      <td className="px-3 py-2">
                        {links.length === 0 ? (
                          <span className="text-muted-foreground">未登録</span>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {links.map((field) => (
                              <a
                                key={field.key}
                                href={competitor.otaUrls?.[field.key] ?? "#"}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-primary hover:underline"
                              >
                                {field.label}
                                <ExternalLink className="h-3 w-3" aria-hidden />
                              </a>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={!canManage}
                            onClick={() => openEdit(competitor)}
                            aria-label={`競合ホテル ${competitor.name} を編集`}
                          >
                            <Edit2 className="h-4 w-4" aria-hidden />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={!canManage || deletingId === competitor.id}
                            onClick={() => setPendingDelete(competitor)}
                            aria-label={`競合ホテル ${competitor.name} を削除`}
                          >
                            {deletingId === competitor.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                            ) : (
                              <Trash2 className="h-4 w-4 text-muted-foreground" aria-hidden />
                            )}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      <CompetitorDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) setEditing(null)
        }}
        competitor={editing}
        saving={saving}
        onSubmit={handleSubmit}
      />

      {/* 削除の確認（F-5） */}
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title="競合ホテルを削除しますか？"
        description={
          pendingDelete
            ? `「${pendingDelete.name}」を削除します。価格比較の対象から外れます。`
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
