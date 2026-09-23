"use client"

// 監査ログ（管理者・運営 — #89 / GET /audit-logs）
// テナント内の操作履歴を新しい順に表示する。ログイン失敗・アカウントのロック・
// トークンの再利用検知など、不正アクセスの兆候もここで確認する。

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/error-state"
import { useAuth } from "@/components/auth-provider"
import { useApiQuery } from "@/hooks/use-api-query"
import { api, ApiClientError, type AuditLogItem } from "@/lib/api"

/** 操作の種類の表示名。未知の値はそのまま出す */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  CREATE: "作成",
  UPDATE: "更新",
  DELETE: "削除",
  LOGIN: "ログイン",
  LOGOUT: "ログアウト",
  LOGIN_FAILED: "ログイン失敗",
  ACCOUNT_LOCKED: "アカウントのロック",
  TOKEN_REUSE_DETECTED: "トークンの再利用を検知",
  PASSWORD_CHANGED: "パスワード変更",
  PASSWORD_RESET: "一時パスワードの発行",
}

/** 注意を向けるべき操作 */
const WARNING_ACTIONS = new Set(["LOGIN_FAILED", "ACCOUNT_LOCKED", "TOKEN_REUSE_DETECTED"])

const ALL_ACTIONS = "__all__"

export function AuditLogSection() {
  const { hotelId } = useAuth()
  const [action, setAction] = useState(ALL_ACTIONS)
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [more, setMore] = useState<AuditLogItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  const filters = { action: action === ALL_ACTIONS ? undefined : action, from: from || undefined, to: to || undefined }
  const { data, loading, error, reload } = useApiQuery(
    hotelId
      ? async () => {
          const page = await api.auditLogs({ hotelId, ...filters })
          setMore([])
          setCursor(page.nextCursor)
          return page.items
        }
      : null,
    [hotelId, action, from, to],
    "監査ログの取得に失敗しました",
  )
  const items = [...(data ?? []), ...more]

  const loadMore = async () => {
    if (!hotelId || !cursor) return
    setLoadingMore(true)
    try {
      const page = await api.auditLogs({ hotelId, ...filters, cursor })
      setMore((prev) => [...prev, ...page.items])
      setCursor(page.nextCursor)
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "監査ログの取得に失敗しました")
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>監査ログ</CardTitle>
        <CardDescription>
          このテナントでの操作履歴です。ログイン失敗・アカウントのロック・トークンの再利用の検知も記録されます。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="audit-action" className="text-xs">操作</Label>
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger id="audit-action" className="h-8 w-48 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_ACTIONS}>すべて</SelectItem>
                {Object.entries(AUDIT_ACTION_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="audit-from" className="text-xs">開始日</Label>
            <Input id="audit-from" type="date" className="h-8 w-40 text-xs" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="audit-to" className="text-xs">終了日</Label>
            <Input id="audit-to" type="date" className="h-8 w-40 text-xs" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>

        {loading ? (
          <Skeleton className="h-40 w-full" />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">条件に合う記録はありません。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-xs">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">日時</th>
                  <th className="py-2 pr-3 font-medium">操作</th>
                  <th className="py-2 pr-3 font-medium">対象</th>
                  <th className="py-2 pr-3 font-medium">ユーザー</th>
                  <th className="py-2 font-medium">IP アドレス</th>
                </tr>
              </thead>
              <tbody>
                {items.map((log) => (
                  <tr key={log.id} className="border-b last:border-0">
                    <td className="whitespace-nowrap py-2 pr-3">{new Date(log.createdAt).toLocaleString("ja-JP")}</td>
                    <td className="py-2 pr-3">
                      <Badge variant={WARNING_ACTIONS.has(log.action) ? "destructive" : "outline"} className="text-[10px]">
                        {AUDIT_ACTION_LABELS[log.action] ?? log.action}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">{log.entity}</td>
                    <td className="py-2 pr-3">{log.user ? `${log.user.name}（${log.user.email}）` : "—"}</td>
                    <td className="py-2 font-mono text-muted-foreground">{log.ipAddress ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {cursor && (
              <Button variant="outline" size="sm" className="mt-3 gap-2" disabled={loadingMore} onClick={() => void loadMore()}>
                {loadingMore && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                さらに読み込む
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
