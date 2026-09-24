"use client"

// 競合価格の取得状況（#9 段階C / GET /settings/competitors/fetch-status）。
// 取得元（OTA・公式サイト）ごとに、自動取得か CSV か・URL を登録した競合の数・最後の取得・最後の成功を並べる。
// 連続失敗（サイトの画面や API が変わった可能性）と、48時間以上更新の無い取得元（推奨に使われない）を目立たせる。

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/error-state"
import { useAuth } from "@/components/auth-provider"
import { useApiQuery } from "@/hooks/use-api-query"
import { api, type CompetitorFetchSourceStatus } from "@/lib/api"

/** 取得元の表示名。未知のキーはそのまま出す */
export const COMPETITOR_SOURCE_LABELS: Record<string, string> = {
  rakuten: "楽天トラベル",
  jalan: "じゃらん",
  ikkyu: "一休.com",
  expedia: "Expedia",
  agoda: "Agoda",
  booking: "Booking.com",
  tripcom: "Trip.com",
  official: "公式サイト",
  manual: "手入力",
  csv: "CSV",
}

/** 推奨に使う競合価格の鮮度（backend の COMPETITOR_PRICE_MAX_AGE_HOURS と同じ） */
const STALE_HOURS = 48

const formatDateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString("ja-JP") : "—")

function health(row: CompetitorFetchSourceStatus, now: number): { label: string; variant: "destructive" | "secondary" | "outline" } {
  if (row.consecutiveFailures >= 2) return { label: `${row.consecutiveFailures}回連続で失敗`, variant: "destructive" }
  if (row.lastRun?.status === "failed") return { label: "前回失敗", variant: "destructive" }
  if (!row.automated) return { label: "CSV で取り込み", variant: "outline" }
  if (!row.lastSucceededAt) return { label: "未取得", variant: "secondary" }
  if (now - new Date(row.lastSucceededAt).getTime() > STALE_HOURS * 3_600_000) {
    return { label: `${STALE_HOURS}時間以上更新なし`, variant: "destructive" }
  }
  return { label: "正常", variant: "secondary" }
}

export function CompetitorFetchStatusSection() {
  const { hotelId } = useAuth()
  const { data, loading, error, reload } = useApiQuery<CompetitorFetchSourceStatus[]>(
    hotelId ? () => api.competitorFetchStatus(hotelId) : null,
    [hotelId],
    "競合価格の取得状況を取得できませんでした",
  )
  const rows = data ?? []
  const now = Date.now()

  return (
    <Card>
      <CardHeader>
        <CardTitle>競合価格の取得状況</CardTitle>
        <CardDescription>
          取得元ごとの最後の取得と成功の日時です。価格が大きく動いた日（10%以上の値下げ・値上げ、満室）はアラートでお知らせします。
          取得から{STALE_HOURS}時間を過ぎた価格は推奨の計算に使いません。
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-32 w-full" />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            取得の記録がありません。競合ホテルに OTA・公式サイトの URL を登録するか、競合価格を CSV で取り込んでください。
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-xs">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">取得元</th>
                  <th className="py-2 pr-3 font-medium">方法</th>
                  <th className="py-2 pr-3 font-medium">URL 登録</th>
                  <th className="py-2 pr-3 font-medium">最後の取得</th>
                  <th className="py-2 pr-3 font-medium">最後の成功</th>
                  <th className="py-2 font-medium">状態</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const h = health(row, now)
                  return (
                    <tr key={row.source} className="border-b align-top last:border-0">
                      <td className="py-2 pr-3 font-medium">{COMPETITOR_SOURCE_LABELS[row.source] ?? row.source}</td>
                      <td className="py-2 pr-3">{row.automated ? "自動取得" : "CSV 取り込み"}</td>
                      <td className="py-2 pr-3">{row.competitorsWithUrl}社</td>
                      <td className="whitespace-nowrap py-2 pr-3">
                        {formatDateTime(row.lastRun?.startedAt ?? null)}
                        {row.lastRun?.status === "succeeded" && (
                          <span className="block text-muted-foreground">{row.lastRun.observations}件</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3">{formatDateTime(row.lastSucceededAt)}</td>
                      <td className="py-2">
                        <Badge variant={h.variant} className="text-[10px]">
                          {h.label}
                        </Badge>
                        {row.lastRun?.status === "failed" && row.lastRun.errorMessage && (
                          <span className="mt-1 block max-w-[240px] break-words text-muted-foreground">
                            {row.lastRun.errorMessage}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
