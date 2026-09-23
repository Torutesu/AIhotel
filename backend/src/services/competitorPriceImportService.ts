import { prisma } from '../lib/prisma.js'
import { BadRequestError, NotFoundError } from '../middlewares/errorHandler.js'
import type { ImportCompetitorPricesInput } from '../lib/validators.js'
import { rebuildRepresentatives } from './competitorRates/representative.js'

// 競合価格の取り込み（#9）。CSV の手動取り込みの入口。自前の取得（jobs/competitor-prices.ts）と同じく、
// 1行を取得元ごとの観測値（CompetitorRateObservation）として残し、競合×宿泊日の代表値（CompetitorPriceData）を
// 観測値から作り直す（services/competitorRates/representative.ts）。取得元ごとに別々に取り込んでもよい。
// 全行を検証してから1トランザクションで書く。1行でも不正なら何も書き込まない（#82 と同じ方針）。

type Row = ImportCompetitorPricesInput['rows'][number]

/** 行の検証（純関数）。field は "rows.<index>.<項目>" */
export function findCompetitorPriceRowErrors(
  rows: Row[],
  competitorIdByName: Map<string, string>
): Array<{ field: string; message: string }> {
  const errors: Array<{ field: string; message: string }> = []
  const seen = new Map<string, number>()
  rows.forEach((row, index) => {
    if (!competitorIdByName.has(row.competitorName)) {
      errors.push({
        field: `rows.${index}.competitorName`,
        message: `競合ホテル「${row.competitorName}」が登録されていません（設定タブの競合ホテル名と一致させてください）`,
      })
    }
    const hasPrice = row.price1P != null || row.price2P != null || row.price3P != null
    if (row.soldOut && hasPrice) {
      errors.push({ field: `rows.${index}.soldOut`, message: '満室の行には料金を入れないでください' })
    }
    if (!row.soldOut && !hasPrice) {
      errors.push({ field: `rows.${index}.price1P`, message: '料金（1〜3名のいずれか）か満室のどちらかが必要です' })
    }
    const key = `${row.competitorName}|${row.date}|${row.source ?? 'manual'}`
    const first = seen.get(key)
    if (first !== undefined) {
      errors.push({ field: `rows.${index}.date`, message: `同じ競合・日付・取得元の行が ${first + 1} 行目にあります` })
    } else {
      seen.set(key, index)
    }
  })
  return errors
}

export interface ImportCompetitorPricesResult {
  dryRun: boolean
  total: number
  /** 競合×宿泊日にまとめた後の件数 */
  aggregated: number
  created: number
  updated: number
  startDate: string
  endDate: string
  tenantId: string
}

export async function importCompetitorPricesService(
  input: ImportCompetitorPricesInput,
  now: Date = new Date()
): Promise<ImportCompetitorPricesResult> {
  const hotel = await prisma.hotel.findFirst({
    where: { id: input.hotelId, isActive: true },
    select: { id: true, tenantId: true },
  })
  if (!hotel) throw new NotFoundError('ホテル')

  const competitors = await prisma.competitor.findMany({
    where: { hotelId: hotel.id, isActive: true },
    select: { id: true, name: true },
  })
  const competitorIdByName = new Map(competitors.map((c) => [c.name, c.id]))

  const errors = findCompetitorPriceRowErrors(input.rows, competitorIdByName)
  if (errors.length > 0) {
    throw new BadRequestError('取り込めない行があります。1行も取り込んでいません', errors)
  }

  const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`)
  const keys = [...new Map(
    input.rows.map((r) => {
      const competitorId = competitorIdByName.get(r.competitorName)!
      return [`${competitorId}|${r.date}`, { competitorId, stayDate: toDate(r.date) }] as const
    })
  ).values()]
  const existing = await prisma.competitorPriceData.count({
    where: { OR: keys.map((k) => ({ competitorId: k.competitorId, date: k.stayDate })) },
  })
  const dates = input.rows.map((r) => r.date).sort()

  const summary = {
    dryRun: Boolean(input.dryRun),
    total: input.rows.length,
    aggregated: keys.length,
    created: keys.length - existing,
    updated: existing,
    startDate: dates[0],
    endDate: dates[dates.length - 1],
    tenantId: hotel.tenantId,
  }
  if (input.dryRun) return summary

  await prisma.$transaction(
    async (tx) => {
      await tx.competitorRateObservation.createMany({
        data: input.rows.map((r) => ({
          tenantId: hotel.tenantId,
          competitorId: competitorIdByName.get(r.competitorName)!,
          stayDate: toDate(r.date),
          source: r.source ?? 'manual',
          price1P: r.price1P ?? null,
          price2P: r.price2P ?? null,
          price3P: r.price3P ?? null,
          soldOut: r.soldOut === true,
          observedAt: r.observedAt ? new Date(r.observedAt) : now,
        })),
      })
      await rebuildRepresentatives(tx, hotel.tenantId, keys)
    },
    { timeout: 60_000 }
  )
  return summary
}
