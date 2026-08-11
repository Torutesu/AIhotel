"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import { AlertCircle, CheckCircle2, Clock, Loader2, PlayCircle, RefreshCw, XCircle } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/components/auth-provider"
import {
  api,
  ApiClientError,
  type IngestFreshness,
  type IngestLogEntry,
  type IngestStatus,
} from "@/lib/api"

// PMSデータ取込の監視パネル（F-ING-01）
//
// データ取得はバックエンドが自動で行う（監視ディレクトリ / HTTPS）。
// この画面の役割は「予定どおり届いているか」を見せることで、
// 人がファイルを上げるのは自動取得が止まったときの代替手段にすぎない。
// 設計は docs/pms-ingest-design.md §A-3。

const SOURCE_LABELS: Record<string, string> = {
  "pms-nights": "宿泊実績（1泊明細）",
  "pms-reservations": "オンハンド予約",
  "pms-inventory": "残室スナップショット",
  segments: "コードマスター",
}

const STATUS_STYLE: Record<
  IngestFreshness,
  { label: string; className: string; Icon: typeof CheckCircle2 }
> = {
  OK: { label: "正常", className: "bg-emerald-100 text-emerald-800", Icon: CheckCircle2 },
  WAITING: { label: "到着待ち", className: "bg-slate-100 text-slate-700", Icon: Clock },
  LATE: { label: "未着", className: "bg-amber-100 text-amber-800", Icon: AlertCircle },
  NEVER: { label: "未取込", className: "bg-amber-100 text-amber-800", Icon: AlertCircle },
  FAILED: { label: "失敗", className: "bg-red-100 text-red-800", Icon: XCircle },
}

const CONNECTOR_LABELS: Record<string, string> = {
  LOCAL_DIR: "監視ディレクトリ",
  HTTPS: "HTTPS取得",
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function DataIngestPanel() {
  const { toast } = useToast()
  const { hotelId, user } = useAuth()
  const canRun = user?.role === "ADMIN" || user?.role === "MANAGER"

  const [status, setStatus] = useState<IngestStatus | null>(null)
  const [logs, setLogs] = useState<IngestLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  const load = useCallback(async () => {
    if (!hotelId) return
    setLoading(true)
    setError(null)
    try {
      const [statusResult, logsResult] = await Promise.all([
        api.ingestStatus(hotelId),
        api.ingestLogs(hotelId, 20),
      ])
      setStatus(statusResult)
      setLogs(logsResult)
    } catch (err) {
      // モックへのサイレントフォールバックはしない（AGENTS.md）
      setError(
        err instanceof ApiClientError ? err.message : "取込状況を取得できませんでした"
      )
    } finally {
      setLoading(false)
    }
  }, [hotelId])

  useEffect(() => {
    void load()
  }, [load])

  const handleRun = async () => {
    if (!hotelId) return
    setRunning(true)
    try {
      const result = await api.runIngestConnectors(hotelId)
      const ingested = result.results.filter((r) => r.outcome === "INGESTED")
      const failed = result.results.filter((r) => r.outcome === "FAILED")
      const rows = ingested
        .flatMap((r) => r.files)
        .reduce((sum, f) => sum + (f.rowCount ?? 0), 0)

      toast({
        title: failed.length > 0 ? "一部の取込に失敗しました" : "自動取込を実行しました",
        description:
          ingested.length > 0
            ? `${ingested.length}件の連携から ${rows.toLocaleString()}行を取り込みました`
            : "新しいデータはありませんでした",
        variant: failed.length > 0 ? "destructive" : undefined,
      })
      await load()
    } catch (err) {
      toast({
        title: "自動取込を実行できませんでした",
        description: err instanceof ApiClientError ? err.message : "通信に失敗しました",
        variant: "destructive",
      })
    } finally {
      setRunning(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>データ取込状況</CardTitle>
          <CardDescription>
            PMSデータはバックエンドが自動で取得します。予定時刻までに届かない連携をここで検知します。
          </CardDescription>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            更新
          </Button>
          {canRun && (
            <Button size="sm" onClick={() => void handleRun()} disabled={running || loading}>
              {running ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <PlayCircle className="mr-2 h-4 w-4" />
              )}
              今すぐ取得
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {loading && (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}

        {!loading && error && (
          <div className="flex items-center justify-between rounded-md border border-destructive/40 bg-destructive/5 p-4">
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              再試行
            </Button>
          </div>
        )}

        {!loading && !error && status && status.items.length === 0 && (
          <p className="text-sm text-muted-foreground">
            監視対象の連携が登録されていません。取込スケジュールを設定すると、
            期待時刻までにデータが届かない場合に検知できます。
          </p>
        )}

        {!loading && !error && status && status.items.length > 0 && (
          <div className="space-y-3">
            {status.items.map((item) => {
              const style = STATUS_STYLE[item.status]
              return (
                <div
                  key={item.source}
                  className="flex flex-col gap-2 rounded-md border p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {SOURCE_LABELS[item.source] ?? item.source}
                      </span>
                      <Badge className={style.className} variant="secondary">
                        <style.Icon className="mr-1 h-3 w-3" />
                        {style.label}
                      </Badge>
                      <Badge variant="outline">
                        {item.connector
                          ? `自動取得: ${CONNECTOR_LABELS[item.connector] ?? item.connector}`
                          : "外部から送信"}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{item.message}</p>
                  </div>
                  <div className="shrink-0 text-sm text-muted-foreground sm:text-right">
                    <div>
                      期待時刻 {item.expectedAt}（猶予{item.graceMinutes}分）
                    </div>
                    <div>最終取込 {formatDateTime(item.lastSuccessAt)}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {!loading && !error && logs.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <h4 className="text-sm font-medium">取込ログ</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">日時</th>
                      <th className="py-2 pr-4 font-medium">連携</th>
                      <th className="py-2 pr-4 font-medium">結果</th>
                      <th className="py-2 pr-4 text-right font-medium">件数</th>
                      <th className="py-2 font-medium">取得元 / エラー</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr key={log.id} className="border-b last:border-0">
                        <td className="whitespace-nowrap py-2 pr-4">
                          {formatDateTime(log.finishedAt ?? log.startedAt)}
                        </td>
                        <td className="py-2 pr-4">{SOURCE_LABELS[log.source] ?? log.source}</td>
                        <td className="py-2 pr-4">
                          <Badge
                            variant="secondary"
                            className={
                              log.status === "SUCCESS"
                                ? "bg-emerald-100 text-emerald-800"
                                : log.status === "PARTIAL"
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-red-100 text-red-800"
                            }
                          >
                            {log.status === "SUCCESS"
                              ? "成功"
                              : log.status === "PARTIAL"
                                ? "一部成功"
                                : "失敗"}
                          </Badge>
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          {log.rowCount?.toLocaleString() ?? "—"}
                        </td>
                        <td className="max-w-[24rem] truncate py-2 text-muted-foreground">
                          {log.error ?? log.origin ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
