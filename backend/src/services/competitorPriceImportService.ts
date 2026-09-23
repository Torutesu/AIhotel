import { prisma } from '../lib/prisma.js'
import { BadRequestError, NotFoundError } from '../middlewares/errorHandler.js'
import type { ImportCompetitorPricesInput } from '../lib/validators.js'

// 競合価格の取り込み（#9 の段階A）。CSV の手動取り込みと、自前の取得（クローラ）の書き込み口を兼ねる。
//
// 1行 = 競合×宿泊日×取得元。同じ競合・同じ日に複数の取得元があれば、人数ごとに最安値を採って
// CompetitorPriceData（競合×宿泊日で1行の代表値）にする（取得条件の統一基準 — #9 §2）。
// 全行を検証してから1トランザクションで書く。1行でも不正なら何も書き込まない（#82 と同じ方針）。
//
// 注: 代表値は「この取り込みに含まれる行」だけから作る。取得元ごとに別々に取り込むと後の取り込みで
// 上書きされるので、同じ日の取得元はまとめて1回で送ること（段階Bで観測値のテーブルを作るまでの制約）。

type Row = ImportCompetitorPricesInput['rows'][number]

export interface AggregatedCompetitorPrice {
  competitorId: string
  date: string
  price1P: number | null
  price2P: number | null
  price3P: number | null
  soldOut: boolean
  observedAt: Date
  sources: string[]
}

const minOrNull = (values: Array<number | null | undefined>): number | null => {
  const present = values.filter((v): v is number => v != null)
  return present.length > 0 ? Math.min(...present) : null
}

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

/** 競合×宿泊日にまとめる（純関数）。人数ごとの最安値、全取得元が満室なら満室、取得日時は最も新しいもの */
export function aggregateCompetitorPrices(
  rows: Row[],
  competitorIdByName: Map<string, string>,
  now: Date
): AggregatedCompetitorPrice[] {
  const groups = new Map<string, Row[]>()
  for (const row of rows) {
    const key = `${competitorIdByName.get(row.competitorName)}|${row.date}`
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  return [...groups.entries()].map(([key, group]) => {
    const [competitorId, date] = key.split('|')
    const observed = group.map((r) => (r.observedAt ? new Date(r.observedAt) : now))
    return {
      competitorId,
      date,
      price1P: minOrNull(group.map((r) => r.price1P)),
      price2P: minOrNull(group.map((r) => r.price2P)),
      price3P: minOrNull(group.map((r) => r.price3P)),
      soldOut: group.every((r) => r.soldOut === true),
      observedAt: new Date(Math.max(...observed.map((d) => d.getTime()))),
      sources: [...new Set(group.map((r) => r.source ?? 'manual'))].sort(),
    }
  })
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

  const aggregated = aggregateCompetitorPrices(input.rows, competitorIdByName, now)
  const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`)
  const existing = await prisma.competitorPriceData.count({
    where: { OR: aggregated.map((a) => ({ competitorId: a.competitorId, date: toDate(a.date) })) },
  })
  const dates = aggregated.map((a) => a.date).sort()

  const summary = {
    dryRun: Boolean(input.dryRun),
    total: input.rows.length,
    aggregated: aggregated.length,
    created: aggregated.length - existing,
    updated: existing,
    startDate: dates[0],
    endDate: dates[dates.length - 1],
    tenantId: hotel.tenantId,
  }
  if (input.dryRun) return summary

  await prisma.$transaction(
    async (tx) => {
      for (const a of aggregated) {
        const values = {
          price1P: a.price1P,
          price2P: a.price2P,
          price3P: a.price3P,
          soldOut: a.soldOut,
          observedAt: a.observedAt,
          // 取得元を残す（例: "csv:jalan+rakuten"）。鮮度は observedAt で判定するので reliability は使わない
          dataSource: `csv:${a.sources.join('+')}`,
          reliability: null,
        }
        await tx.competitorPriceData.upsert({
          where: { competitorId_date: { competitorId: a.competitorId, date: toDate(a.date) } },
          update: values,
          create: { tenantId: hotel.tenantId, competitorId: a.competitorId, date: toDate(a.date), ...values },
        })
      }
    },
    { timeout: 60_000 }
  )
  return summary
}
