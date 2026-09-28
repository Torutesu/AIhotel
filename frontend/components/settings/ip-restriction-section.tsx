"use client"

// IP 制限（テナントの管理者 — #12）。
// 有効にすると、このテナントのユーザーは許可リストのアドレス・範囲からしか使えなくなる（ログイン中でも次の操作から止まる）。
// 締め出し防止: 自分のアクセス元が許可リストに入っていないと有効にして保存できない（バックエンドが 400 にする）。
// それでも締め出されたときは運営が解除する。

import { useEffect, useState } from "react"
import { Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { ErrorState } from "@/components/error-state"
import { useApiQuery } from "@/hooks/use-api-query"
import { api, ApiClientError, type IpAllowEntry, type IpRestrictionSettings } from "@/lib/api"

/** 単一アドレスか範囲か（簡易チェック。正確な検証はバックエンドが行う） */
export function looksLikeCidr(value: string): boolean {
  const v = value.trim()
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/
  const ipv6 = /^[0-9a-f:]+(\/\d{1,3})?$/i
  return ipv4.test(v) || (v.includes(":") && ipv6.test(v))
}

export function IpRestrictionSection() {
  const { data, loading, error, reload } = useApiQuery<IpRestrictionSettings>(
    () => api.ipRestriction(),
    [],
    "IP 制限の設定を取得できませんでした",
  )
  const [enabled, setEnabled] = useState(false)
  const [entries, setEntries] = useState<IpAllowEntry[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!data) return
    setEnabled(data.enabled)
    setEntries(data.entries)
  }, [data])

  const currentIp = data?.currentIp ?? null
  const currentIncluded = currentIp !== null && entries.some((e) => e.cidr.trim() === currentIp)
  const invalid = entries.some((e) => !looksLikeCidr(e.cidr))

  const update = (index: number, patch: Partial<IpAllowEntry>) =>
    setEntries((prev) => prev.map((e, i) => (i === index ? { ...e, ...patch } : e)))

  const save = async () => {
    setSaving(true)
    try {
      const saved = await api.updateIpRestriction({
        enabled,
        entries: entries.map((e) => ({ cidr: e.cidr.trim(), label: e.label?.trim() || null })),
      })
      setEnabled(saved.enabled)
      setEntries(saved.entries)
      toast.success(saved.enabled ? "IP 制限を保存しました" : "IP 制限を無効にしました")
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "IP 制限の保存に失敗しました")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" aria-hidden />
          IP アドレス制限
        </CardTitle>
        <CardDescription>
          有効にすると、この会社のユーザーは登録したアドレス・範囲（社内ネットワークなど）からしか使えなくなります。
          自分のアクセス元が入っていないと保存できません。締め出された場合は運営にご連絡ください。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <Skeleton className="h-32 w-full" />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : (
          <>
            <div className="flex items-center gap-3">
              <Switch id="ip-restriction-enabled" checked={enabled} onCheckedChange={setEnabled} />
              <Label htmlFor="ip-restriction-enabled">IP 制限を有効にする</Label>
            </div>

            <p className="text-xs text-muted-foreground">
              あなたの今のアクセス元: <span className="font-mono">{currentIp ?? "不明"}</span>
              {currentIp && !currentIncluded && (
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto px-2 py-0 text-xs"
                  onClick={() => setEntries((prev) => [...prev, { cidr: currentIp, label: "今のアクセス元" }])}
                >
                  許可リストに追加
                </Button>
              )}
            </p>

            <div className="space-y-2">
              {entries.length === 0 && (
                <p className="text-xs text-muted-foreground">許可するアドレスはまだ登録されていません。</p>
              )}
              {entries.map((entry, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    aria-label={`許可するアドレス ${index + 1}`}
                    className="h-8 w-56 font-mono text-xs"
                    placeholder="203.0.113.0/24"
                    value={entry.cidr}
                    aria-invalid={!looksLikeCidr(entry.cidr) || undefined}
                    onChange={(e) => update(index, { cidr: e.target.value })}
                  />
                  <Input
                    aria-label={`メモ ${index + 1}`}
                    className="h-8 flex-1 text-xs"
                    placeholder="例: 本社、〇〇ホテル"
                    maxLength={50}
                    value={entry.label ?? ""}
                    onChange={(e) => update(index, { label: e.target.value })}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2"
                    aria-label={`${entry.cidr || "この行"} を削除`}
                    onClick={() => setEntries((prev) => prev.filter((_, i) => i !== index))}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              ))}
              {invalid && (
                <p className="text-xs text-destructive">
                  IP アドレスか範囲（例: 203.0.113.10、203.0.113.0/24）で入力してください。
                </p>
              )}
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={entries.length >= 50}
                onClick={() => setEntries((prev) => [...prev, { cidr: "", label: null }])}
              >
                <Plus className="h-4 w-4" aria-hidden />
                アドレスを追加
              </Button>
            </div>

            <div className="flex justify-end border-t pt-3">
              <Button size="sm" className="gap-2" disabled={saving || invalid} onClick={() => void save()}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                保存
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
