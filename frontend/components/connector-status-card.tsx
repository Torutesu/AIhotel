"use client"

// サイトコントローラー連携（コネクタ）のステータス・操作カード（設定タブ内）。
// 鮮度・デバイス死活・直近ジョブ・凍結スイッチ・定期取得設定・ペアリングコード発行を扱う。
// 設計: docs/コネクタ連携設計.md §14（連携ステータスウィジェット）

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { AlertCircle, Copy, Loader2, MonitorSmartphone, Play, Plus, RefreshCw } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/components/auth-provider"
import { api, ApiClientError, type ConnectorStatus, type ConnectorJobSummary } from "@/lib/api"

const DEVICE_ALIVE_THRESHOLD_MS = 5 * 60 * 1000 // heartbeat途絶の閾値（backendの§10.2と同値）

const INTERVAL_OPTIONS = [
  { value: 60, label: "1時間ごと" },
  { value: 180, label: "3時間ごと" },
  { value: 360, label: "6時間ごと（推奨）" },
  { value: 720, label: "12時間ごと" },
] as const

const JOB_STATUS_LABELS: Record<ConnectorJobSummary["status"], string> = {
  PENDING: "待機中",
  RUNNING: "実行中",
  DONE: "完了",
  FAILED: "失敗",
  CANCELLED: "取消",
  NEEDS_REVIEW: "要確認",
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`
}

function freshness(lastReadIso: string | null): { label: string; variant: "default" | "secondary" | "destructive" } {
  if (!lastReadIso) return { label: "未取得", variant: "secondary" }
  const ageHours = (Date.now() - new Date(lastReadIso).getTime()) / (60 * 60 * 1000)
  if (ageHours < 6) return { label: "正常", variant: "default" }
  if (ageHours < 12) return { label: "stale（6時間超）", variant: "secondary" }
  return { label: "停止中（12時間超）", variant: "destructive" }
}

export function ConnectorStatusCard() {
  const { toast } = useToast()
  const { hotelId, user } = useAuth()
  const canManage = user?.role === "ADMIN" || user?.role === "MANAGER"

  const [status, setStatus] = useState<ConnectorStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mutating, setMutating] = useState(false)

  const [pairingOpen, setPairingOpen] = useState(false)
  const [pairingDeviceName, setPairingDeviceName] = useState("")
  const [issuedCode, setIssuedCode] = useState<{ code: string; expiresAt: string } | null>(null)

  const load = useCallback(async () => {
    if (!hotelId) return
    setLoading(true)
    setError(null)
    try {
      setStatus(await api.connectorStatus(hotelId))
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "連携ステータスの取得に失敗しました")
    } finally {
      setLoading(false)
    }
  }, [hotelId])

  useEffect(() => {
    load()
  }, [load])

  const runMutation = async (action: () => Promise<unknown>, successMessage: string) => {
    setMutating(true)
    try {
      await action()
      toast({ title: successMessage })
      await load()
    } catch (err) {
      toast({
        title: "操作に失敗しました",
        description: err instanceof ApiClientError ? err.message : String(err),
        variant: "destructive",
      })
    } finally {
      setMutating(false)
    }
  }

  const handleIssuePairingCode = async () => {
    if (!hotelId || !pairingDeviceName.trim()) return
    setMutating(true)
    try {
      const result = await api.connectorCreatePairingCode(hotelId, pairingDeviceName.trim())
      setIssuedCode(result)
    } catch (err) {
      toast({
        title: "ペアリングコードの発行に失敗しました",
        description: err instanceof ApiClientError ? err.message : String(err),
        variant: "destructive",
      })
    } finally {
      setMutating(false)
    }
  }

  const copyCode = async () => {
    if (!issuedCode) return
    await navigator.clipboard.writeText(issuedCode.code)
    toast({ title: "コードをコピーしました" })
  }

  const state = status?.state ?? null
  const fresh = freshness(state?.lastSuccessfulReadAt ?? null)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>サイトコントローラー連携</CardTitle>
            <CardDescription>
              リンカーン等からの料金ランク自動取得・反映の稼働状況
              {!canManage && "（操作にはMANAGER以上の権限が必要です）"}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            更新
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <AlertCircle className="w-6 h-6 text-destructive" />
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" onClick={load} className="gap-2">
              <RefreshCw className="w-4 h-4" />
              再試行
            </Button>
          </div>
        ) : (
          <>
            {/* 鮮度・最終同期 */}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">データ鮮度</span>
                <Badge variant={fresh.variant}>{fresh.label}</Badge>
              </div>
              <div className="text-sm text-muted-foreground">
                最終取得: <span className="text-foreground">{formatDateTime(state?.lastSuccessfulReadAt ?? null)}</span>
              </div>
              <div className="text-sm text-muted-foreground">
                最終反映: <span className="text-foreground">{formatDateTime(state?.lastSuccessfulWriteAt ?? null)}</span>
              </div>
              {state?.writeFrozen && (
                <Badge variant="destructive">
                  書き込み凍結中{state.writeFrozenReason ? `: ${state.writeFrozenReason}` : ""}
                </Badge>
              )}
            </div>

            {/* 未解決の連携アラート */}
            {status && status.openAlerts.length > 0 && (
              <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 space-y-1">
                {status.openAlerts.map((alert) => (
                  <div key={alert.eventKey} className="flex items-center gap-2 text-sm">
                    <AlertCircle className="w-4 h-4 text-destructive shrink-0" />
                    <Badge variant={alert.severity === "SEV1" ? "destructive" : "secondary"}>{alert.severity}</Badge>
                    <span>{alert.eventKey}</span>
                    <span className="text-muted-foreground">
                      初回 {formatDateTime(alert.firstFiredAt)}・{alert.fireCount}回
                    </span>
                  </div>
                ))}
              </div>
            )}

            <Separator />

            {/* エージェントデバイス */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2">
                  <MonitorSmartphone className="w-4 h-4" />
                  エージェントデバイス
                </Label>
                {canManage && (
                  <Button size="sm" variant="outline" className="gap-2" onClick={() => setPairingOpen(true)}>
                    <Plus className="w-4 h-4" />
                    デバイスを追加
                  </Button>
                )}
              </div>
              {status && status.devices.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">
                  デバイスが未登録です。「デバイスを追加」でペアリングコードを発行し、クライアントPCのエージェントに入力してください。
                </p>
              ) : (
                <div className="space-y-1">
                  {status?.devices.map((device) => {
                    const alive =
                      device.lastSeenAt !== null &&
                      Date.now() - new Date(device.lastSeenAt).getTime() < DEVICE_ALIVE_THRESHOLD_MS
                    return (
                      <div
                        key={device.id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-sm"
                      >
                        <span
                          className={`inline-block w-2 h-2 rounded-full ${alive ? "bg-emerald-500" : "bg-destructive"}`}
                          aria-label={alive ? "稼働中" : "応答なし"}
                        />
                        <span className="font-medium">{device.name}</span>
                        <Badge variant="outline">{device.role === "PRIMARY" ? "主系" : "待機系"}</Badge>
                        <span className="text-muted-foreground">
                          最終応答 {formatDateTime(device.lastSeenAt)}
                          {device.agentVersion ? `・v${device.agentVersion}` : ""}
                        </span>
                        {user?.role === "ADMIN" && hotelId && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="ml-auto text-destructive hover:text-destructive"
                            disabled={mutating}
                            onClick={() =>
                              runMutation(
                                () => api.connectorRevokeDevice(hotelId, device.id),
                                "デバイスを失効しました"
                              )
                            }
                          >
                            失効
                          </Button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <Separator />

            {/* 自動取得設定・操作 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <div>
                  <Label>自動取得</Label>
                  <p className="text-xs text-muted-foreground">料金ランクを定期的に自動取得します</p>
                </div>
                <Switch
                  checked={state?.autoReadEnabled ?? true}
                  disabled={!canManage || mutating || !hotelId}
                  onCheckedChange={(checked) =>
                    hotelId &&
                    runMutation(
                      () => api.connectorUpdateSyncConfig(hotelId, { autoReadEnabled: checked }),
                      checked ? "自動取得を有効にしました" : "自動取得を無効にしました"
                    )
                  }
                />
              </div>
              <div className="flex items-center justify-between rounded-md border px-3 py-2 gap-3">
                <div>
                  <Label>取得間隔</Label>
                  <p className="text-xs text-muted-foreground">鮮度SLOは6時間です</p>
                </div>
                <Select
                  value={String(state?.readIntervalMinutes ?? 360)}
                  disabled={!canManage || mutating || !hotelId}
                  onValueChange={(value) =>
                    hotelId &&
                    runMutation(
                      () => api.connectorUpdateSyncConfig(hotelId, { readIntervalMinutes: Number(value) }),
                      "取得間隔を更新しました"
                    )
                  }
                >
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INTERVAL_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={String(option.value)}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <div>
                  <Label>自動書き込み</Label>
                  <p className="text-xs text-muted-foreground">凍結中は取得のみ継続します</p>
                </div>
                <Switch
                  checked={!(state?.writeFrozen ?? false)}
                  disabled={!canManage || mutating || !hotelId}
                  onCheckedChange={(checked) =>
                    hotelId &&
                    runMutation(
                      () => api.connectorSetFreeze(hotelId, !checked),
                      checked ? "自動書き込みを再開しました" : "自動書き込みを凍結しました"
                    )
                  }
                />
              </div>
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <div>
                  <Label>今すぐ取得</Label>
                  <p className="text-xs text-muted-foreground">臨時のREADジョブを投入します</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2"
                  disabled={!canManage || mutating || !hotelId}
                  onClick={() =>
                    hotelId &&
                    runMutation(() => api.connectorRunReadNow(hotelId), "取得ジョブを投入しました")
                  }
                >
                  {mutating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                  実行
                </Button>
              </div>
            </div>

            {/* 直近ジョブ */}
            {status && status.recentJobs.length > 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  <Label>直近のジョブ</Label>
                  <div className="space-y-1">
                    {status.recentJobs.slice(0, 5).map((job) => (
                      <div key={job.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                        <Badge
                          variant={
                            job.status === "DONE"
                              ? "default"
                              : job.status === "FAILED" || job.status === "NEEDS_REVIEW"
                                ? "destructive"
                                : "secondary"
                          }
                        >
                          {JOB_STATUS_LABELS[job.status]}
                        </Badge>
                        <span>
                          {job.target === "LINCOLN" ? "リンカーン" : "ねほっぷす"}・
                          {job.direction === "READ" ? "取得" : "反映"}
                          {job.dryRun ? "（dry-run）" : ""}
                        </span>
                        <span className="text-muted-foreground">{formatDateTime(job.createdAt)}</span>
                        {job.errorCode && <span className="text-destructive text-xs">{job.errorCode}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </CardContent>

      {/* ペアリングコード発行ダイアログ */}
      <Dialog
        open={pairingOpen}
        onOpenChange={(open) => {
          setPairingOpen(open)
          if (!open) {
            setPairingDeviceName("")
            setIssuedCode(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>エージェントデバイスの追加</DialogTitle>
            <DialogDescription>
              ペアリングコードは10分間・1回だけ有効です。クライアントPCのエージェントで
              <code className="mx-1">pair &lt;コード&gt;</code>を実行してください。
            </DialogDescription>
          </DialogHeader>
          {issuedCode ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Input readOnly value={issuedCode.code} className="font-mono" />
                <Button variant="outline" size="icon" onClick={copyCode} aria-label="コードをコピー">
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                有効期限: {formatDateTime(issuedCode.expiresAt)}（このコードは再表示できません）
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="pairing-device-name">デバイス名</Label>
                <Input
                  id="pairing-device-name"
                  placeholder="例: フロントPC1"
                  value={pairingDeviceName}
                  onChange={(e) => setPairingDeviceName(e.target.value)}
                />
              </div>
              <Button
                onClick={handleIssuePairingCode}
                disabled={mutating || !pairingDeviceName.trim()}
                className="gap-2"
              >
                {mutating ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                コードを発行
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  )
}
