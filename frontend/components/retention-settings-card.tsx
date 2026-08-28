"use client"

// データ保持期間の設定（SAAS_DECISIONS.md D-06）。
// 会社ごとに内部統制の要求が異なるため、テナント単位で設定できる。

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { AlertCircle, Loader2, RefreshCw, Save } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { api, ApiClientError, type RetentionSettings } from "@/lib/api"

export function RetentionSettingsCard({ canManage }: { canManage: boolean }) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [auditDays, setAuditDays] = useState(730)
  const [operationalDays, setOperationalDays] = useState(365)
  // 日次実績は既定で無期限。収益の元帳にあたるため、消すのは明示的な操作に限る
  const [limitDailyData, setLimitDailyData] = useState(false)
  const [dailyDataDays, setDailyDataDays] = useState(1095)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const settings = await api.retentionSettings()
      setAuditDays(settings.auditLogRetentionDays)
      setOperationalDays(settings.operationalDataRetentionDays)
      setLimitDailyData(settings.dailyDataRetentionDays != null)
      if (settings.dailyDataRetentionDays != null) setDailyDataDays(settings.dailyDataRetentionDays)
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "保持期間の取得に失敗しました")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleSave = async () => {
    setSaving(true)
    try {
      const payload: Partial<RetentionSettings> = {
        auditLogRetentionDays: auditDays,
        operationalDataRetentionDays: operationalDays,
        dailyDataRetentionDays: limitDailyData ? dailyDataDays : null,
      }
      await api.updateRetentionSettings(payload)
      toast({
        title: "データ保持期間を保存しました",
        description: "次回の定期削除から適用されます。",
      })
    } catch (err) {
      toast({
        title: "保存に失敗しました",
        description: err instanceof ApiClientError ? err.message : undefined,
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>データ保持期間</CardTitle>
        <CardDescription>
          期間を過ぎたデータは定期削除の対象になります
          {!canManage && "（変更にはMANAGER以上の権限が必要です）"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="space-y-2">
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="audit-days">監査ログ（日）</Label>
                <Input
                  id="audit-days"
                  type="number"
                  min={30}
                  max={3650}
                  value={auditDays}
                  onChange={(e) => setAuditDays(Number.parseInt(e.target.value) || 0)}
                  disabled={!canManage}
                />
                <p className="text-xs text-muted-foreground">
                  誰がいつ何を変更したかの記録。内部統制の要求に合わせて設定します（30日以上）
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="operational-days">運用ログ（日）</Label>
                <Input
                  id="operational-days"
                  type="number"
                  min={30}
                  max={3650}
                  value={operationalDays}
                  onChange={(e) => setOperationalDays(Number.parseInt(e.target.value) || 0)}
                  disabled={!canManage}
                />
                <p className="text-xs text-muted-foreground">
                  対応済みアラート・AIコメント・KPIスナップショット。未対応のアラートは削除されません
                </p>
              </div>
            </div>

            <div className="rounded-lg border p-3 space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <Label htmlFor="limit-daily">日次実績に保持期間を設ける</Label>
                  <p className="text-xs text-muted-foreground">
                    既定は無期限です。日次実績は収益の元帳にあたるため、
                    削除すると過去との比較ができなくなります
                  </p>
                </div>
                <Switch
                  id="limit-daily"
                  checked={limitDailyData}
                  onCheckedChange={setLimitDailyData}
                  disabled={!canManage}
                />
              </div>
              {limitDailyData && (
                <div className="space-y-2">
                  <Label htmlFor="daily-days">日次実績（日）</Label>
                  <Input
                    id="daily-days"
                    type="number"
                    min={365}
                    max={3650}
                    value={dailyDataDays}
                    onChange={(e) => setDailyDataDays(Number.parseInt(e.target.value) || 0)}
                    disabled={!canManage}
                  />
                  <p className="text-xs text-muted-foreground">365日以上を指定してください</p>
                </div>
              )}
            </div>

            {canManage && (
              <div className="flex justify-end">
                <Button size="sm" className="gap-2" onClick={handleSave} disabled={saving}>
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  保存
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
