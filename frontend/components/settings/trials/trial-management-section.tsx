"use client"

// トライアル（デモ）アカウントの管理（運営 = PLATFORM_ADMIN 専用）。
// 販売店・営業先ホテルに渡す期限つきのログイン ID を、発行・延長・停止／再開・パスワード再発行・削除する。
// 1件ごとに専用のデモホテル（デモデータ入り）を持つので、触られても他のトライアルや顧客には影響しない。
// 期限を過ぎると使えなくなり、30日後に自動で削除される。

import { useState } from "react"
import { KeyRound, Pause, Play, Plus, Timer, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { ErrorState } from "@/components/error-state"
import { useApiQuery } from "@/hooks/use-api-query"
import { api, ApiClientError } from "@/lib/api"
import { TRIAL_KIND_LABELS, type TrialLoginInfo, type TrialSummary } from "@shared/types"
import { TrialCreateDialog, toCreateTrialRequest, type TrialFormValues } from "./trial-create-dialog"
import { TrialCredentialsDialog } from "./trial-credentials-dialog"
import { AgencySelect } from "@/components/operations-directory"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { demoShared } from "@/lib/api/demo-shared"
import { TrialCommandBox } from "./trial-command-box"
import type { TrialCommand } from "@/lib/trial-command"

/** 延長ボタンで足す日数 */
const EXTEND_DAYS = 30
/** この日数以内に期限が来るものを目立たせる */
const SOON_DAYS = 7

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("ja-JP", { year: "numeric", month: "numeric", day: "numeric", timeZone: "Asia/Tokyo" }) : "—"

export function trialStatusBadge(trial: TrialSummary): { label: string; variant: "secondary" | "destructive" | "outline" } {
  if (trial.status === "SUSPENDED") return { label: "停止中", variant: "outline" }
  if (trial.status === "EXPIRED") return { label: "期限切れ", variant: "destructive" }
  if (trial.daysLeft <= SOON_DAYS) return { label: `残り${trial.daysLeft}日`, variant: "destructive" }
  return { label: `残り${trial.daysLeft}日`, variant: "secondary" }
}

type PendingAction = { kind: "reset" | "delete"; trial: TrialSummary }

export function TrialManagementSection({ platform = false }: { platform?: boolean }) {
  const agencies = useApiQuery(() => platform ? demoShared.agencies() : Promise.resolve([]), [platform], "代理店を取得できませんでした")
  const [assignment, setAssignment] = useState<TrialSummary | null>(null)
  const [owner, setOwner] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const { data, loading, error, reload } = useApiQuery<TrialSummary[]>(
    () => api.trials(),
    [],
    "トライアルの一覧を取得できませんでした",
  )
  const trials = data ?? []
  const visibleTrials = trials.filter(t => `${t.name} ${t.loginEmail ?? ""}`.toLowerCase().includes(search.toLowerCase()))
  const [createOpen, setCreateOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [credentials, setCredentials] = useState<TrialLoginInfo | null>(null)
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
      <CardHeader className="flex flex-col gap-4 space-y-0 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>トライアル一覧</CardTitle>
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
        <Input aria-label="トライアルを検索" placeholder="顧客名・メールアドレスで検索" value={search} onChange={e => setSearch(e.target.value)} className="mb-4 sm:max-w-sm" />
        {!loading && !error && <TrialCommandBox trials={trials} onRun={runCommand} />}
        {loading ? (
          <Skeleton className="h-32 w-full" />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : trials.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">発行したトライアルはありません。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="block w-full text-sm md:table md:text-xs">
              <thead className="hidden md:table-header-group">
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">渡し先</th>
                  <th className="py-2 pr-3 font-medium">ログイン ID</th>
                  <th className="py-2 pr-3 font-medium">期限</th>
                  <th className="py-2 pr-3 font-medium">最終ログイン</th>
                  <th className="py-2 font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="block md:table-row-group">
                {!visibleTrials.length && <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">該当するトライアルはありません。</td></tr>}
                {visibleTrials.map((trial) => {
                  const badge = trialStatusBadge(trial)
                  const busy = busyId === trial.id
                  return (
                    <tr key={trial.id} className="grid grid-cols-2 gap-x-3 border-b py-4 align-top last:border-0 md:table-row md:py-0">
                      <td className="col-span-2 block break-all py-2 md:table-cell md:pr-3">
                        <span className="font-medium">{trial.name}</span>
                        {platform && <p className="my-2 text-xs text-muted-foreground">担当：{trial.agencyId ? agencies.data?.find(a => a.id === trial.agencyId)?.name ?? "代理店" : "全体管理者のみ"}</p>}
                        <Badge variant="outline" className="ml-2 text-[10px]">
                          {TRIAL_KIND_LABELS[trial.kind]}
                        </Badge>
                        {trial.note && <span className="mt-0.5 block text-muted-foreground">{trial.note}</span>}
                      </td>
                      <td className="col-span-2 block break-all pb-3 text-xs md:table-cell md:py-2 md:pr-3">{trial.loginEmail ?? "—"}</td>
                      <td className="block py-2 text-xs md:table-cell md:whitespace-nowrap md:pr-3">
                        <span className="mb-1 block text-muted-foreground md:hidden">利用期限</span>
                        {formatDate(trial.expiresAt)}まで
                        <Badge variant={badge.variant} className="ml-2 text-[10px]">
                          {badge.label}
                        </Badge>
                        {trial.purgeAt && (
                          <span className="block text-muted-foreground">{formatDate(trial.purgeAt)}に自動削除</span>
                        )}
                      </td>
                      <td className="block py-2 text-xs md:table-cell md:whitespace-nowrap md:pr-3">
                        <span className="mb-1 block text-muted-foreground md:hidden">最終ログイン</span>
                        {trial.lastLoginAt ? new Date(trial.lastLoginAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) : "未ログイン"}
                      </td>
                      <td className="col-span-2 block py-2 md:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {platform && <Button variant="outline" size="sm" disabled={busy} onClick={() => { setAssignment(trial); setOwner(trial.agencyId ?? null) }}>担当変更</Button>}
                          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={busy}
                            onClick={() => void run(trial.id, async () => {
                              setCredentials(await api.trialLoginInfo(trial.id))
                            }, "ログイン情報を取得できませんでした")}>
                            ログイン情報
                          </Button>
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

      <Dialog open={!!assignment} onOpenChange={v => { if (!v) setAssignment(null) }}><DialogContent><DialogHeader><DialogTitle>トライアルの担当代理店を変更</DialogTitle><DialogDescription>割り当てた代理店に、ログイン情報・操作権限・過去の活用状況を共有します。元の代理店はアクセスできなくなります。</DialogDescription></DialogHeader><p className="text-sm break-words">{assignment?.name}</p><AgencySelect accounts={agencies.data ?? []} value={owner} onChange={setOwner} /><Button disabled={!!busyId} onClick={() => { if (assignment) void run(assignment.id, async () => { await demoShared.assignTrial(assignment.id, owner); setAssignment(null) }, "担当変更に失敗しました") }}>担当を変更する</Button></DialogContent></Dialog>
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
