// 前年の稼働残差からイベント候補を検出して Event（status=candidate, source=detected）に保存する。
// 候補の承認/却下もここ。需要予測は status=confirmed のイベントだけを使う
import { prisma } from '../../lib/prisma.js'
import { NotFoundError } from '../../middlewares/errorHandler.js'
import { detectEventCandidates, type EventCandidate } from './eventDetection.js'
import { toIsoDate } from '../signals/holidaySignal.js'

function addUtcDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

export interface DetectResult {
  hotelId: string
  tenantId: string
  analyzedDays: number
  candidates: number
  created: number
  skippedExisting: number
}

/**
 * 直近 lookbackDays（既定 400 日）の実績からスパイクを検出し、翌年の候補（同曜日ベース）を作る
 */
export async function detectEventCandidatesService(hotelId: string, createdByUserId: string, lookbackDays = 400): Promise<DetectResult> {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId }, select: { tenantId: true } })
  if (!hotel) throw new NotFoundError('ホテル')

  const today = new Date()
  const start = addUtcDays(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())), -lookbackDays)
  const [history, knownEvents, existingDetected] = await Promise.all([
    prisma.dailyData.findMany({
      where: { hotelId, date: { gte: start }, occupancy: { not: null } },
      select: { date: true, occupancy: true },
      orderBy: { date: 'asc' },
    }),
    prisma.event.findMany({
      where: { hotelId, status: { not: 'rejected' }, startDate: { gte: start } },
      select: { startDate: true, endDate: true },
    }),
    prisma.event.findMany({ where: { hotelId, source: 'detected' }, select: { sourceRef: true } }),
  ])
  const existingRefs = new Set(existingDetected.map((e) => e.sourceRef))

  const candidates = detectEventCandidates(
    history.map((h) => ({ date: h.date, occupancy: h.occupancy! })),
    knownEvents
  )

  let created = 0
  let skippedExisting = 0
  for (const c of candidates) {
    const ref = `${toIsoDate(c.observedStart)}..${toIsoDate(c.observedEnd)}`
    if (existingRefs.has(ref)) {
      skippedExisting++
      continue
    }
    await prisma.event.create({ data: candidateToEvent(c, hotelId, hotel.tenantId, ref, createdByUserId) })
    created++
  }
  return { hotelId, tenantId: hotel.tenantId, analyzedDays: history.length, candidates: candidates.length, created, skippedExisting }
}

function candidateToEvent(c: EventCandidate, hotelId: string, tenantId: string, ref: string, createdByUserId: string) {
  const days = Math.round((c.observedEnd.getTime() - c.observedStart.getTime()) / 86_400_000) + 1
  return {
    hotelId,
    tenantId,
    name: `年次イベント候補（前年 ${toIsoDate(c.observedStart)}${days > 1 ? `〜${toIsoDate(c.observedEnd)}` : ''} に稼働 +${Math.round(c.peakResidualPt * 100)}pt）`,
    type: 'other',
    // 候補日は同曜日（364日後）を既定にする。同日（暦日）は description に併記し、承認時に編集できる
    startDate: c.suggestedSameWeekday.start,
    endDate: c.suggestedSameWeekday.end,
    expectedImpact: c.suggestedImpact,
    description: `前年の同時期に、曜日・祝日では説明できない稼働の上振れ（平均 +${Math.round(c.avgResidualPt * 100)}pt / 最大 +${Math.round(c.peakResidualPt * 100)}pt）がありました。同曜日ベースの候補日: ${toIsoDate(c.suggestedSameWeekday.start)}〜${toIsoDate(c.suggestedSameWeekday.end)}、同日ベース: ${toIsoDate(c.suggestedSameDate.start)}〜${toIsoDate(c.suggestedSameDate.end)}。実際のイベントが分かればイベント名と日付を編集して承認してください。`,
    source: 'detected',
    status: 'candidate',
    sourceRef: ref,
    createdByUserId,
  }
}

export async function getEventCandidatesService(hotelId: string) {
  return prisma.event.findMany({
    where: { hotelId, status: 'candidate' },
    orderBy: { startDate: 'asc' },
    include: { venue: { select: { id: true, name: true } } },
  })
}

export async function reviewEventCandidateService(
  id: string,
  hotelId: string,
  decision: 'approve' | 'reject',
  overrides?: { name?: string; startDate?: Date; endDate?: Date; expectedImpact?: 'high' | 'medium' | 'low'; type?: string }
) {
  const result = await prisma.event.updateMany({
    where: { id, hotelId, status: 'candidate' },
    data: { status: decision === 'approve' ? 'confirmed' : 'rejected', ...(decision === 'approve' ? overrides : {}) },
  })
  if (result.count === 0) throw new NotFoundError('イベント候補')
  return prisma.event.findUnique({ where: { id } })
}
