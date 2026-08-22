"use client"

// レピュテーション管理セクション（分析タブ — F-ANA-04）
// 口コミ評価点をサイト別に一覧・推移表示し、手動で登録できる。
// 価格算定には使用しない参考指標。サイトからの自動取得はPhase 4。

import { useState, useEffect, useCallback, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import { AlertCircle, Loader2, Plus, RefreshCw, Star, Trash2 } from "lucide-react"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/components/auth-provider"
import { api, ApiClientError, type ReviewScoreItem } from "@/lib/api"

const SOURCE_LABELS: Record<string, string> = {
  google: "Google",
  tripadvisor: "TripAdvisor",
  rakuten: "楽天トラベル",
  jalan: "じゃらん",
  ikkyu: "一休",
  expedia: "Expedia",
  agoda: "Agoda",
}

const SOURCE_COLORS = ["#2563eb", "#16a34a", "#dc2626", "#f59e0b", "#7c3aed", "#0891b2"]

const sourceLabel = (source: string) => SOURCE_LABELS[source] ?? source

export function ReputationSection() {
  const { hotelId, user } = useAuth()
  const { toast } = useToast()
  const canManage = user?.role === "ADMIN" || user?.role === "MANAGER"

  const [scores, setScores] = useState<ReviewScoreItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [newSource, setNewSource] = useState("google")
  const [newScore, setNewScore] = useState("")
  const [newReviewCount, setNewReviewCount] = useState("")
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!hotelId) return
    setLoading(true)
    setError(null)
    try {
      setScores(await api.reviewScores(hotelId))
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "口コミ評価点の取得に失敗しました")
    } finally {
      setLoading(false)
    }
  }, [hotelId])

  useEffect(() => {
    load()
  }, [load])

  // サイト別の最新スコアと推移グラフ用データ
  const { latestBySource, chartData, sources } = useMemo(() => {
    const latest = new Map<string, ReviewScoreItem>()
    for (const s of scores) {
      const cur = latest.get(s.source)
      if (!cur || new Date(s.capturedAt) > new Date(cur.capturedAt)) latest.set(s.source, s)
    }
    const srcs = [...latest.keys()].sort()
    const byMonth = new Map<string, Record<string, number | string>>()
    for (const s of [...scores].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))) {
      const key = s.capturedAt.slice(0, 7)
      const entry = byMonth.get(key) ?? { month: key }
      entry[s.source] = s.score
      byMonth.set(key, entry)
    }
    return { latestBySource: latest, chartData: [...byMonth.values()], sources: srcs }
  }, [scores])

  const handleCreate = async () => {
    if (!hotelId) return
    const score = Number.parseFloat(newScore)
    if (!Number.isFinite(score)) {
      toast({ variant: "destructive", title: "評価点を入力してください（0〜5）" })
      return
    }
    setSaving(true)
    try {
      await api.createReviewScore({
        hotelId,
        source: newSource.trim(),
        score,
        ...(newReviewCount.trim() && { reviewCount: Number.parseInt(newReviewCount) || 0 }),
      })
      toast({ title: "口コミ評価点を登録しました" })
      setNewScore("")
      setNewReviewCount("")
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
      await api.deleteReviewScore(id, hotelId)
      toast({ title: "口コミ評価点を削除しました" })
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
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Star className="w-4 h-4" />
          レピュテーション管理（口コミ評価点）
        </CardTitle>
        <CardDescription>
          サイト別の口コミ評価点を記録し推移を確認します。価格算定には使用しない参考指標です（自動取得はPhase 4、現在は手動登録）
          {!canManage && "（登録・削除にはMANAGER以上の権限が必要です）"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <Skeleton className="h-56 w-full" />
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
            {latestBySource.size > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[...latestBySource.entries()].map(([source, item]) => (
                  <div key={source} className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">{sourceLabel(source)}</div>
                    <div className="text-lg font-semibold flex items-baseline gap-1">
                      {item.score.toFixed(2)}
                      <span className="text-xs text-muted-foreground font-normal">/ 5</span>
                    </div>
                    {item.reviewCount != null && (
                      <div className="text-xs text-muted-foreground">{item.reviewCount.toLocaleString()}件</div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {chartData.length > 1 && (
              <div>
                <p className="text-xs text-muted-foreground mb-2">評価点の推移（月次）</p>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                      <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                      <YAxis domain={[3, 5]} tick={{ fontSize: 10 }} width={30} />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      {sources.map((source, i) => (
                        <Line
                          key={source}
                          type="monotone"
                          dataKey={source}
                          name={sourceLabel(source)}
                          stroke={SOURCE_COLORS[i % SOURCE_COLORS.length]}
                          strokeWidth={2}
                          dot={false}
                          connectNulls
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {scores.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">
                口コミ評価点の登録はまだありません。
              </p>
            )}

            <Separator />

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
              <div className="space-y-2">
                <Label htmlFor="review-source">取得元サイト</Label>
                <Input
                  id="review-source"
                  value={newSource}
                  onChange={(e) => setNewSource(e.target.value)}
                  placeholder="google / rakuten 等"
                  disabled={!canManage}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="review-score">評価点（0〜5）</Label>
                <Input
                  id="review-score"
                  type="number"
                  step={0.01}
                  min={0}
                  max={5}
                  value={newScore}
                  onChange={(e) => setNewScore(e.target.value)}
                  placeholder="4.20"
                  disabled={!canManage}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="review-count">口コミ件数（任意）</Label>
                <Input
                  id="review-count"
                  type="number"
                  min={0}
                  value={newReviewCount}
                  onChange={(e) => setNewReviewCount(e.target.value)}
                  placeholder="1250"
                  disabled={!canManage}
                />
              </div>
              <Button
                className="gap-2"
                onClick={handleCreate}
                disabled={!canManage || !newSource.trim() || !newScore.trim() || saving || !hotelId}
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                登録
              </Button>
            </div>

            {scores.length > 0 && (
              <div className="overflow-x-auto max-h-64 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card">
                    <tr className="border-b">
                      <th className="text-left py-2 px-3 font-medium">取得日</th>
                      <th className="text-left py-2 px-3 font-medium">サイト</th>
                      <th className="text-right py-2 px-3 font-medium">評価点</th>
                      <th className="text-right py-2 px-3 font-medium">件数</th>
                      <th className="text-center py-2 px-3 font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scores.map((s) => (
                      <tr key={s.id} className="border-b hover:bg-muted/50">
                        <td className="py-2 px-3 whitespace-nowrap">{s.capturedAt.slice(0, 10)}</td>
                        <td className="py-2 px-3">{sourceLabel(s.source)}</td>
                        <td className="text-right py-2 px-3">{s.score.toFixed(2)}</td>
                        <td className="text-right py-2 px-3">
                          {s.reviewCount != null ? s.reviewCount.toLocaleString() : "-"}
                        </td>
                        <td className="text-center py-2 px-3">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={!canManage || deletingId === s.id}
                            onClick={() => handleDelete(s.id)}
                          >
                            {deletingId === s.id ? (
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
          </>
        )}
      </CardContent>
    </Card>
  )
}
