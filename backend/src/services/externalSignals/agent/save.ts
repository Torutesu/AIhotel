import { prisma } from '../../../lib/prisma.js'
import type { AgentFindings } from './findings.js'

// 外部要因エージェントの結果を保存する（D-13）。
// - 人が登録した行（source = manual）には触れない。同じ名前・同じ日の行が人の登録にあれば、エージェントの結果は捨てる
// - エージェントが前に登録した行は上書きする（日付・影響度・根拠の更新）
// - 前回あって今回見つからなかった行は消さない（検索の当たり外れで消えたり戻ったりしないように。不要なら画面で消す）

const date = (s: string) => new Date(`${s}T00:00:00Z`)

export interface SaveResult {
  events: number
  openings: number
  signals: number
  /** 人の登録と重なって捨てた件数 */
  skippedManual: number
}

export async function saveAgentFindings(hotel: { id: string; tenantId: string }, findings: AgentFindings): Promise<SaveResult> {
  const result: SaveResult = { events: 0, openings: 0, signals: 0, skippedManual: 0 }

  for (const e of findings.events) {
    const startDate = date(e.startDate)
    const existing = await prisma.event.findFirst({
      where: { hotelId: hotel.id, name: e.name, startDate },
      select: { id: true, source: true },
    })
    if (existing && existing.source !== 'agent') {
      result.skippedManual++
      continue
    }
    const data = {
      name: e.name,
      type: e.type,
      startDate,
      endDate: date(e.endDate),
      location: e.location,
      expectedImpact: e.expectedImpact,
      description: e.description,
      excludeFromHistory: e.excludeFromHistory,
      sourceUrl: e.sourceUrl,
    }
    if (existing) await prisma.event.update({ where: { id: existing.id }, data })
    else await prisma.event.create({ data: { ...data, tenantId: hotel.tenantId, hotelId: hotel.id, source: 'agent' } })
    result.events++
  }

  for (const o of findings.newHotelOpenings) {
    const openingDate = date(o.openingDate)
    const key = { hotelId_name_openingDate: { hotelId: hotel.id, name: o.name, openingDate } }
    const existing = await prisma.newHotelOpening.findUnique({ where: key, select: { source: true } })
    if (existing && existing.source !== 'agent') {
      result.skippedManual++
      continue
    }
    const data = {
      rooms: o.rooms,
      category: o.category,
      location: o.location,
      distanceKm: o.distanceKm,
      expectedImpact: o.expectedImpact,
      notes: o.notes,
      sourceUrl: o.sourceUrl,
    }
    await prisma.newHotelOpening.upsert({
      where: key,
      create: { ...data, tenantId: hotel.tenantId, hotelId: hotel.id, name: o.name, openingDate, source: 'agent' },
      update: data,
    })
    result.openings++
  }

  for (const s of findings.marketSignals) {
    const periodStart = date(s.periodStart)
    const data = {
      summary: s.summary,
      periodEnd: date(s.periodEnd),
      direction: s.direction,
      magnitude: s.magnitude,
      sourceUrl: s.sourceUrl,
    }
    await prisma.marketSignal.upsert({
      where: { hotelId_kind_title_periodStart: { hotelId: hotel.id, kind: s.kind, title: s.title, periodStart } },
      create: { ...data, tenantId: hotel.tenantId, hotelId: hotel.id, kind: s.kind, title: s.title, periodStart },
      update: data,
    })
    result.signals++
  }
  return result
}
