import { prisma } from '../../lib/prisma.js'
import { addUtcDays, todayJst } from '../../lib/date.js'
import { rebuildRepresentatives } from './representative.js'
import { raisePriceMoveAlerts } from './monitoring.js'
import type { CompetitorRateSource } from './types.js'
import { SiteBlockedError } from './crawler/pageSignals.js'
import { config } from '../../lib/config.js'

// 競合価格の定期取得（#9 段階B）。登録済みの取得元（sources.ts）を、URL が登録されている競合に対して順に呼ぶ。
// 取得元ごとに実行記録（CompetitorFetchRun）を残し、観測値を保存してから代表値を作り直す。
// 1つの取得元の失敗で他の取得元・他のホテルを止めない。
// サイトに止められた兆候（SiteBlockedError）で失敗したら、実行記録の理由を "BLOCKED:" で始め、CRAWL_BLOCK_COOLDOWN_HOURS の間は
// どのホテルについてもその取得元を呼ばない（D-13 — 止められた直後に取り直してブロックを強めない）。

/** 取得する宿泊日の範囲（今日から何日先まで — #9 §2） */
export const FETCH_DAYS_AHEAD = 90

export interface HotelFetchResult {
  hotelId: string
  source: string
  status: 'succeeded' | 'failed' | 'skipped'
  observations: number
  /** 価格の変動を知らせるアラートを作った件数（monitoring.ts） */
  alerts: number
  /** 同じ取得元が直前にも失敗していたら true（連続失敗 — 運営に通知する） */
  consecutiveFailure: boolean
  errorMessage?: string
}

export async function fetchCompetitorRatesForHotel(
  hotelId: string,
  sources: CompetitorRateSource[],
  now: Date = new Date()
): Promise<HotelFetchResult[]> {
  const hotel = await prisma.hotel.findFirst({ where: { id: hotelId, isActive: true }, select: { tenantId: true } })
  if (!hotel || sources.length === 0) return []

  const competitors = await prisma.competitor.findMany({
    where: { hotelId, isActive: true },
    select: { id: true, name: true, otaUrls: true },
  })
  const today = todayJst(now)
  const stayDates = Array.from({ length: FETCH_DAYS_AHEAD }, (_, i) => addUtcDays(today, i).toISOString().slice(0, 10))

  const results: HotelFetchResult[] = []
  for (const source of sources) {
    const targets = competitors.flatMap((c) => {
      const url = (c.otaUrls as Record<string, string | null> | null)?.[source.key]
      return url ? [{ competitorId: c.id, competitorName: c.name, url }] : []
    })
    if (targets.length === 0) continue
    if (await isCoolingDown(source.key, now)) {
      results.push({ hotelId, source: source.key, status: 'skipped', observations: 0, alerts: 0, consecutiveFailure: false, errorMessage: 'ブロックの兆候のため休止中' })
      continue
    }

    const run = await prisma.competitorFetchRun.create({
      data: { tenantId: hotel.tenantId, hotelId, source: source.key, startedAt: now },
    })
    try {
      const rows: Array<{ competitorId: string; rates: Awaited<ReturnType<CompetitorRateSource['fetch']>> }> = []
      if (source.fetchBatch) {
        const byCompetitor = await source.fetchBatch(targets, stayDates)
        for (const target of targets) rows.push({ competitorId: target.competitorId, rates: byCompetitor.get(target.competitorId) ?? [] })
      } else {
        for (const target of targets) rows.push({ competitorId: target.competitorId, rates: await source.fetch(target, stayDates) })
      }

      const observations = rows.flatMap(({ competitorId, rates }) =>
        rates.map((r) => ({
          tenantId: hotel.tenantId,
          competitorId,
          stayDate: new Date(`${r.stayDate}T00:00:00Z`),
          source: source.key,
          price1P: r.soldOut ? null : r.price1P,
          price2P: r.soldOut ? null : r.price2P,
          price3P: r.soldOut ? null : r.price3P,
          soldOut: r.soldOut,
          observedAt: now,
          runId: run.id,
        }))
      )
      const alerts = await prisma.$transaction(
        async (tx) => {
          if (observations.length > 0) await tx.competitorRateObservation.createMany({ data: observations })
          const { changes } = await rebuildRepresentatives(tx, hotel.tenantId, observations)
          const raised = await raisePriceMoveAlerts(tx, { hotelId, tenantId: hotel.tenantId, changes, now })
          await tx.competitorFetchRun.update({
            where: { id: run.id },
            data: { status: 'succeeded', finishedAt: new Date(), observations: observations.length },
          })
          return raised
        },
        { timeout: 120_000 }
      )
      results.push({ hotelId, source: source.key, status: 'succeeded', observations: observations.length, alerts, consecutiveFailure: false })
    } catch (error) {
      const message = `${error instanceof SiteBlockedError ? BLOCKED_PREFIX : ''}${error instanceof Error ? error.message : String(error)}`
      await prisma.competitorFetchRun.update({
        where: { id: run.id },
        data: { status: 'failed', finishedAt: new Date(), errorMessage: message.slice(0, 1000) },
      })
      const previous = await prisma.competitorFetchRun.findFirst({
        where: { hotelId, source: source.key, id: { not: run.id }, status: { not: 'running' } },
        orderBy: { startedAt: 'desc' },
        select: { status: true },
      })
      results.push({
        hotelId,
        source: source.key,
        status: 'failed',
        observations: 0,
        alerts: 0,
        consecutiveFailure: previous?.status === 'failed',
        errorMessage: message,
      })
    }
  }
  return results
}

export const BLOCKED_PREFIX = 'BLOCKED: '

/** 取得元が、止められた兆候のあと休止している間か（全ホテル共通） */
export async function isCoolingDown(source: string, now: Date = new Date()): Promise<boolean> {
  const since = new Date(now.getTime() - config.CRAWL_BLOCK_COOLDOWN_HOURS * 3600_000)
  const blocked = await prisma.competitorFetchRun.findFirst({
    where: { source, status: 'failed', errorMessage: { startsWith: BLOCKED_PREFIX }, startedAt: { gte: since } },
    select: { id: true },
  })
  return blocked != null
}
