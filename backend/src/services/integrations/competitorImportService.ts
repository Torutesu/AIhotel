// 競合価格の取り込み（docs/外部要因設計.md §3 #5, #6）。
// スクレイピング（URL提供待ち）やレートショッピングAPIが入るまでの手動/CSV 取り込みと、
// 将来のアダプタ（RateShopperAdapter）の共通着地点。売止め（soldOut）はエリア逼迫シグナルになる
import { prisma } from '../../lib/prisma.js'
import { NotFoundError } from '../../middlewares/errorHandler.js'

export interface CompetitorPriceRow {
  /** competitorId か competitorName のどちらか必須。名前が未登録なら競合を自動作成する */
  competitorId?: string
  competitorName?: string
  date: Date
  price1P?: number | null
  price2P?: number | null
  price3P?: number | null
  soldOut?: boolean
  dataSource?: string
  reliability?: 'high' | 'medium' | 'low'
}

export interface CompetitorImportResult {
  hotelId: string
  tenantId: string
  imported: number
  createdCompetitors: string[]
  skipped: Array<{ row: number; reason: string }>
}

/**
 * レートショッピング/スクレイピングのアダプタ。実装は rows を返すだけで、保存はこのサービスが行う
 */
export interface RateShopperAdapter {
  name: string
  fetchRates(hotelId: string, startDate: Date, endDate: Date): Promise<CompetitorPriceRow[]>
}

function dateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

export async function importCompetitorPricesService(hotelId: string, rows: CompetitorPriceRow[]): Promise<CompetitorImportResult> {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId }, select: { tenantId: true } })
  if (!hotel) throw new NotFoundError('ホテル')
  const competitors = await prisma.competitor.findMany({ where: { hotelId }, select: { id: true, name: true } })
  const byId = new Map(competitors.map((c) => [c.id, c]))
  const byName = new Map(competitors.map((c) => [c.name, c]))
  const createdCompetitors: string[] = []
  const skipped: CompetitorImportResult['skipped'] = []
  let imported = 0

  for (const [i, row] of rows.entries()) {
    let competitor = row.competitorId ? byId.get(row.competitorId) : row.competitorName ? byName.get(row.competitorName) : undefined
    if (!competitor && row.competitorName) {
      competitor = await prisma.competitor.create({ data: { hotelId, tenantId: hotel.tenantId, name: row.competitorName }, select: { id: true, name: true } })
      byId.set(competitor.id, competitor)
      byName.set(competitor.name, competitor)
      createdCompetitors.push(competitor.name)
    }
    if (!competitor) {
      skipped.push({ row: i + 1, reason: '競合が特定できません（competitorId か competitorName が必要）' })
      continue
    }
    if (row.price1P == null && row.price2P == null && row.price3P == null && !row.soldOut) {
      skipped.push({ row: i + 1, reason: '価格も売止めもありません' })
      continue
    }
    const date = dateOnly(row.date)
    await prisma.competitorPriceData.upsert({
      where: { competitorId_date: { competitorId: competitor.id, date } },
      update: {
        price1P: row.price1P ?? null,
        price2P: row.price2P ?? null,
        price3P: row.price3P ?? null,
        soldOut: row.soldOut ?? false,
        dataSource: row.dataSource ?? 'import',
        reliability: row.reliability ?? null,
      },
      create: {
        competitorId: competitor.id,
        tenantId: hotel.tenantId,
        date,
        price1P: row.price1P ?? null,
        price2P: row.price2P ?? null,
        price3P: row.price3P ?? null,
        soldOut: row.soldOut ?? false,
        dataSource: row.dataSource ?? 'import',
        reliability: row.reliability ?? null,
      },
    })
    imported++
  }
  return { hotelId, tenantId: hotel.tenantId, imported, createdCompetitors, skipped }
}

/**
 * 日別の競合売止め比率（売止め件数 ÷ その日にデータのある競合数）。データが無い日は含めない
 */
export async function getCompetitorSoldOutShareService(hotelId: string, startDate: Date, endDate: Date): Promise<Map<string, number>> {
  const rows = await prisma.competitorPriceData.findMany({
    where: { date: { gte: startDate, lte: endDate }, competitor: { hotelId, isActive: true } },
    select: { date: true, soldOut: true, soldOutIgnored: true },
  })
  const agg = new Map<string, { total: number; soldOut: number }>()
  for (const r of rows) {
    const key = r.date.toISOString().slice(0, 10)
    const a = agg.get(key) ?? { total: 0, soldOut: 0 }
    a.total++
    if (r.soldOut && !r.soldOutIgnored) a.soldOut++
    agg.set(key, a)
  }
  const out = new Map<string, number>()
  for (const [key, a] of agg) if (a.total > 0) out.set(key, a.soldOut / a.total)
  return out
}

/**
 * 特定日の競合の売止めを逼迫シグナルから除外する／戻す（団体の売止め等。会話FBからも呼ばれる）
 */
export async function setCompetitorSoldOutIgnoredService(
  hotelId: string,
  competitorId: string,
  date: Date,
  ignored: boolean,
  reason?: string
): Promise<{ competitorId: string; competitorName: string; date: string; soldOut: boolean; soldOutIgnored: boolean }> {
  const competitor = await prisma.competitor.findFirst({ where: { id: competitorId, hotelId }, select: { id: true, name: true } })
  if (!competitor) throw new NotFoundError('競合ホテル')
  const row = await prisma.competitorPriceData.findUnique({ where: { competitorId_date: { competitorId, date } } })
  if (!row) throw new NotFoundError('この日の競合価格データ')
  const updated = await prisma.competitorPriceData.update({
    where: { id: row.id },
    data: { soldOutIgnored: ignored, soldOutIgnoredReason: ignored ? (reason ?? null) : null },
  })
  return { competitorId, competitorName: competitor.name, date: date.toISOString().slice(0, 10), soldOut: updated.soldOut, soldOutIgnored: updated.soldOutIgnored }
}
