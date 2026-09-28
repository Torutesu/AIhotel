"use client"

// トライアル（デモ）アカウントの管理（運営 = PLATFORM_ADMIN 専用）。
// 販売店・営業先ホテルに渡す期限つきのログイン ID を、発行・延長・停止／再開・パスワード再発行・削除する。
// 1件ごとに専用のデモホテル（デモデータ入り）を持つので、触られても他のトライアルや顧客には影響しない。
// 期限を過ぎると使えなくなり、30日後に自動で削除される。

import { useState } from "react"
import { KeyRound, Pause, Play, Plus, Timer, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { ErrorState } from "@/components/error-state"
import { useApiQuery } from "@/hooks/use-api-query"
import { api, ApiClientError } from "@/lib/api"
import { TRIAL_KIND_LABELS, type TrialCredentials, type TrialSummary } from "@shared/types"
import { TrialCreateDialog, toCreateTrialRequest, type TrialFormValues } from "./trial-create-dialog"
import { TrialCredentialsDialog } from "./trial-credentials-dialog"
import { TrialCommandBox } from "./trial-command-box"
import type { TrialCommand } from "@/lib/trial-command"

/** 延長ボタンで足す日数 */
const EXTEND_DAYS = 30
/** この日数以内に期限が来るものを目立たせる */
const SOON_DAYS = 7

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("ja-JP", { year: "numeric", month: "numeric", day: "numeric" }) : "—"

export function trialStatusBadge(trial: TrialSummary): { label: string; variant: "secondary" | "destructive" | "outline" } {
  if (trial.status === "SUSPENDED") return { label: "停止中", variant: "outline" }
  if (trial.status === "EXPIRED") return { label: "期限切れ", variant: "destructive" }
  if (trial.daysLeft <= SOON_DAYS) return { label: `残り${trial.daysLeft}日`, variant: "destructive" }
  return { label: `残り${trial.daysLeft}日`, variant: "secondary" }
}

type PendingAction = { kind: "reset" | "delete"; trial: TrialSummary }

export function TrialManagementSection() {
  const { data, loading, error, reload } = useApiQuery<TrialSummary[]>(
    () => api.trials(),
    [],
    "トライアルの一覧を取得できませんでした",
  )
  const trials = data ?? []
  const [createOpen, setCreateOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [credentials, setCredentials] = useState<TrialCredentials | null>(null)
  const [pending, setPending] = useState<PendingAction | null>(null)

  const run = async (id: string | null, action: () => Promise<void>, failure: string) => {
    setBusyId(id)
    try {
      await action()
      reload()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : failure)
    } finally {
      setBusyId(null)
    }
  }

  const handleCreate = async (values: TrialFormValues) => {
    setSaving(true)
    try {
      const issued = await api.createTrial(toCreateTrialRequest(values))
      setCreateOpen(false)
      setCredentials(issued)
      reload()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "トライアルの発行に失敗しました")
    } finally {
      setSaving(false)
    }
  }

  const extend = (trial: TrialSummary) =>
    run(trial.id, async () => {
      const updated = await api.updateTrial(trial.id, { extendDays: EXTEND_DAYS })
      toast.success(`「${trial.name}」の期限を${formatDate(updated.expiresAt)}まで延長しました`)
    }, "期限の延長に失敗しました")

  const toggle = (trial: TrialSummary) =>
    run(trial.id, async () => {
      const suspend = trial.status !== "SUSPENDED"
      await api.updateTrial(trial.id, { isActive: !suspend })
      toast.success(suspend ? `「${trial.name}」を停止しました` : `「${trial.name}」を再開しました`)
    }, "トライアルの更新に失敗しました")

  /** 「文章で指示」の実行。失敗はトーストで出し、入力を残すために投げ直す */
  const runCommand = async (command: TrialCommand) => {
    try {
      switch (command.type) {
        case "create":
          setCredentials(await api.createTrial({ name: command.name, kind: command.kind, days: command.days }))
          break
        case "extend": {
          const updated = await api.updateTrial(command.trial.id, { extendDays: command.days })
          toast.success(`「${command.trial.name}」の期限を${formatDate(updated.expiresAt)}まで延長しました`)
          break
        }
        case "suspend":
        case "resume":
          await api.updateTrial(command.trial.id, { isActive: command.type === "resume" })
          toast.success(`「${command.trial.name}」を${command.type === "resume" ? "再開" : "停止"}しました`)
          break
        case "reset":
          setCredentials(await api.resetTrialPassword(command.trial.id))
          break
        case "delete":
          await api.deleteTrial(command.trial.id)
          toast.success(`「${command.trial.name}」を削除しました`)
          break
      }
      reload()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "実行に失敗しました")
      throw err
    }
  }

  const confirmPending = () => {
    const action = pending
    setPending(null)
    if (!action) return
    if (action.kind === "reset") {
      void run(action.trial.id, async () => {
        setCredentials(await api.resetTrialPassword(action.trial.id))
      }, "パスワードの再発行に失敗しました")
    } else {
      void run(action.trial.id, async () => {
        await api.deleteTrial(action.trial.id)
        toast.success(`「${action.trial.name}」を削除しました`)
      }, "トライアルの削除に失敗しました")
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>トライアル管理（運営）</CardTitle>
          <CardDescription>
            販売店・営業先ホテルに渡すデモ用のログイン ID を管理します。1件ごとにデモデータ入りの専用ホテルを持ち、
            期限を過ぎるとログインできなくなります（30日後に自動で削除）。
          </CardDescription>
        </div>
        <Button size="sm" className="gap-2" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden />
          トライアルを発行
        </Button>
      </CardHeader>
      <CardContent>
        {!loading && !error && <TrialCommandBox trials={trials} onRun={runCommand} />}
        {loading ? (
          <Skeleton className="h-32 w-full" />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : trials.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">発行したトライアルはありません。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-xs">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">渡し先</th>
                  <th className="py-2 pr-3 font-medium">ログイン ID</th>
                  <th className="py-2 pr-3 font-medium">期限</th>
                  <th className="py-2 pr-3 font-medium">最終ログイン</th>
                  <th className="py-2 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {trials.map((trial) => {
                  const badge = trialStatusBadge(trial)
                  const busy = busyId === trial.id
                  return (
                    <tr key={trial.id} className="border-b align-top last:border-0">
                      <td className="py-2 pr-3">
                        <span className="font-medium">{trial.name}</span>
                        <Badge variant="outline" className="ml-2 text-[10px]">
                          {TRIAL_KIND_LABELS[trial.kind]}
                        </Badge>
                        {trial.note && <span className="mt-0.5 block text-muted-foreground">{trial.note}</span>}
                      </td>
                      <td className="py-2 pr-3 font-mono">{trial.loginEmail ?? "—"}</td>
                      <td className="whitespace-nowrap py-2 pr-3">
                        {formatDate(trial.expiresAt)}まで
                        <Badge variant={badge.variant} className="ml-2 text-[10px]">
                          {badge.label}
                        </Badge>
                        {trial.purgeAt && (
                          <span className="block text-muted-foreground">{formatDate(trial.purgeAt)}に自動削除</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3">
                        {trial.lastLoginAt ? new Date(trial.lastLoginAt).toLocaleString("ja-JP") : "未ログイン"}
                      </td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-1">
                          <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" disabled={busy} onClick={() => void extend(trial)}>
                            <Timer className="h-3.5 w-3.5" aria-hidden />
                            {EXTEND_DAYS}日延長
                          </Button>
                          <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" disabled={busy} onClick={() => void toggle(trial)}>
                            {trial.status === "SUSPENDED" ? (
                              <Play className="h-3.5 w-3.5" aria-hidden />
                            ) : (
                              <Pause className="h-3.5 w-3.5" aria-hidden />
                            )}
                            {trial.status === "SUSPENDED" ? "再開" : "停止"}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1 px-2 text-xs"
                            disabled={busy}
                            onClick={() => setPending({ kind: "reset", trial })}
                          >
                            <KeyRound className="h-3.5 w-3.5" aria-hidden />
                            パスワード再発行
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1 px-2 text-xs text-destructive"
                            disabled={busy}
                            onClick={() => setPending({ kind: "delete", trial })}
                            aria-label={`「${trial.name}」を削除`}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
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

      <TrialCreateDialog open={createOpen} onOpenChange={setCreateOpen} saving={saving} onSubmit={(v) => void handleCreate(v)} />
      <TrialCredentialsDialog credentials={credentials} onClose={() => setCredentials(null)} />
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={pending?.kind === "delete" ? "トライアルを削除しますか？" : "パスワードを再発行しますか？"}
        description={
          pending?.kind === "delete"
            ? `「${pending.trial.name}」のログイン ID とデモデータをすべて削除します。元に戻せません。`
            : pending
              ? `「${pending.trial.name}」の今のパスワードは使えなくなり、ログイン中の端末もログアウトされます。`
              : undefined
        }
        confirmLabel={pending?.kind === "delete" ? "削除する" : "再発行する"}
        destructive={pending?.kind === "delete"}
        onConfirm={confirmPending}
      />
    </Card>
  )
}
