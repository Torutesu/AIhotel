import { prisma } from '../../lib/prisma.js'
import { competitorRateSources } from './sources.js'
import type { CompetitorPriceSourceKey, CompetitorRateSource } from './types.js'

// 競合価格の取得状況（#9 段階C）。設定タブで「どのサイトを、いつまで取れているか」を見るためのもの。
// 取得元ごとに、URL を登録した競合の数・最後の実行・最後に成功した日時・連続失敗の回数を返す。

/** 直近の実行をさかのぼる件数（連続失敗の回数を数えるため） */
const RECENT_RUNS = 20

export interface CompetitorFetchSourceStatus {
  source: string
  /** 自動取得の処理が登録されているか。false なら CSV の取り込みで入れる */
  automated: boolean
  /** この取得元の URL を登録した競合の数 */
  competitorsWithUrl: number
  lastRun: {
    startedAt: string
    finishedAt: string | null
    status: string
    observations: number
    errorMessage: string | null
  } | null
  lastSucceededAt: string | null
  /** 直近から数えて続いている失敗の回数 */
  consecutiveFailures: number
}

export async function getCompetitorFetchStatusService(
  hotelId: string,
  sources: CompetitorRateSource[] = competitorRateSources
): Promise<CompetitorFetchSourceStatus[]> {
  const [competitors, runs] = await Promise.all([
    prisma.competitor.findMany({ where: { hotelId, isActive: true }, select: { otaUrls: true } }),
    prisma.competitorFetchRun.findMany({
      where: { hotelId },
      orderBy: { startedAt: 'desc' },
      take: 500,
      select: { source: true, startedAt: true, finishedAt: true, status: true, observations: true, errorMessage: true },
    }),
  ])

  const urlCounts = new Map<string, number>()
  for (const c of competitors) {
    for (const [key, url] of Object.entries((c.otaUrls as Record<string, string | null> | null) ?? {})) {
      if (url) urlCounts.set(key, (urlCounts.get(key) ?? 0) + 1)
    }
  }
  const automated = new Set<string>(sources.map((s) => s.key))
  const keys = [...new Set<string>([...automated, ...urlCounts.keys(), ...runs.map((r) => r.source)])]

  return keys
    .map((source): CompetitorFetchSourceStatus => {
      const own = runs.filter((r) => r.source === source).slice(0, RECENT_RUNS)
      const finished = own.filter((r) => r.status !== 'running')
      const firstNonFailure = finished.findIndex((r) => r.status !== 'failed')
      const last = own[0]
      const lastSucceeded = own.find((r) => r.status === 'succeeded')
      return {
        source,
        automated: automated.has(source as CompetitorPriceSourceKey),
        competitorsWithUrl: urlCounts.get(source) ?? 0,
        lastRun: last
          ? {
              startedAt: last.startedAt.toISOString(),
              finishedAt: last.finishedAt?.toISOString() ?? null,
              status: last.status,
              observations: last.observations,
              errorMessage: last.errorMessage,
            }
          : null,
        lastSucceededAt: lastSucceeded?.startedAt.toISOString() ?? null,
        consecutiveFailures: firstNonFailure === -1 ? finished.length : firstNonFailure,
      }
    })
    .sort((a, b) => Number(b.automated) - Number(a.automated) || b.competitorsWithUrl - a.competitorsWithUrl || a.source.localeCompare(b.source))
}
