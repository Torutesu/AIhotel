// 会場ページを取得し、Claude API（構造化出力）でイベント候補を抽出して Event（status=candidate, source=extracted）に保存する。
// ANTHROPIC_API_KEY 未設定なら 400 を返す（Phase 4 の Claude 連携。docs/外部要因設計.md §3 #3 b）。
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { prisma } from '../../lib/prisma.js'
import { config } from '../../lib/config.js'
import { BadRequestError, NotFoundError } from '../../middlewares/errorHandler.js'
import { logger } from '../../utils/logger.js'
import {
  ExtractionResultSchema,
  EXTRACTION_SYSTEM_PROMPT,
  buildExtractionUserMessage,
  htmlToText,
  normalizeExtractedEvents,
  type ExtractionResult,
} from './venueExtraction.js'
import { estimateEventImpact } from './eventImpact.js'
import { toIsoDate } from '../signals/holidaySignal.js'

export interface VenueExtractor {
  extract(params: { venueName: string; url: string; asOfDate: string; pageText: string }): Promise<ExtractionResult>
}

/**
 * Claude API による抽出器。構造化出力（zod スキーマ）で JSON を受け取る
 */
export function createClaudeExtractor(): VenueExtractor {
  if (!config.ANTHROPIC_API_KEY) {
    throw new BadRequestError('会場ページの抽出には ANTHROPIC_API_KEY の設定が必要です')
  }
  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY })
  return {
    async extract(params) {
      const response = await client.messages.parse({
        model: config.ANTHROPIC_MODEL,
        max_tokens: 16000,
        system: EXTRACTION_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildExtractionUserMessage(params) }],
        output_config: { format: zodOutputFormat(ExtractionResultSchema) },
      })
      if (response.stop_reason === 'refusal') {
        throw new BadRequestError('Claude がこのページの処理を拒否しました')
      }
      if (!response.parsed_output) {
        throw new BadRequestError('Claude の応答を解釈できませんでした（構造化出力が空）')
      }
      return response.parsed_output
    },
  }
}

export interface ExtractVenueEventsResult {
  venueId: string
  venueName: string
  url: string
  truncated: boolean
  extracted: number
  created: number
  skippedDuplicates: number
  notes: string | null
}

export async function fetchVenuePage(url: string): Promise<string> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(config.EXTERNAL_API_TIMEOUT_MS),
    headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'AIhotel-revenue-bot/1.0 (+event calendar extraction)' },
  })
  if (!res.ok) throw new BadRequestError(`会場ページの取得に失敗しました: HTTP ${res.status}`)
  return res.text()
}

/**
 * 会場のイベントカレンダーページからイベント候補を作る
 */
export async function extractVenueEventsService(
  venueId: string,
  hotelId: string,
  createdByUserId: string,
  extractor?: VenueExtractor,
  fetchPage: (url: string) => Promise<string> = fetchVenuePage
): Promise<ExtractVenueEventsResult> {
  const venue = await prisma.venue.findFirst({ where: { id: venueId, hotelId }, include: { hotel: { select: { totalRooms: true } } } })
  if (!venue) throw new NotFoundError('会場')
  if (!venue.websiteUrl) throw new BadRequestError('会場にイベントカレンダーのURLが設定されていません')

  const ext = extractor ?? createClaudeExtractor()
  const html = await fetchPage(venue.websiteUrl)
  const { text, truncated } = htmlToText(html)
  if (truncated) logger.warn({ venueId, url: venue.websiteUrl }, `会場ページが長いため先頭 ${text.length} 文字のみを抽出対象にしました`)
  if (text.length < 50) throw new BadRequestError('会場ページから本文を取得できませんでした（JavaScript描画のページの可能性があります）')

  const asOfDate = toIsoDate(new Date())
  const result = await ext.extract({ venueName: venue.name, url: venue.websiteUrl, asOfDate, pageText: text })
  const events = normalizeExtractedEvents(result, asOfDate)

  let created = 0
  let skippedDuplicates = 0
  for (const e of events) {
    const startDate = new Date(`${e.startDate}T00:00:00.000Z`)
    const endDate = new Date(`${e.endDate}T00:00:00.000Z`)
    const dup = await prisma.event.findFirst({
      where: { hotelId, name: e.name, startDate, status: { not: 'rejected' } },
      select: { id: true },
    })
    if (dup) {
      skippedDuplicates++
      continue
    }
    await prisma.event.create({
      data: {
        hotelId,
        tenantId: venue.tenantId,
        venueId: venue.id,
        name: e.name,
        type: e.type,
        startDate,
        endDate,
        location: venue.name,
        expectedAttendance: e.expectedAttendance,
        expectedImpact:
          estimateEventImpact({ capacity: venue.capacity, distanceKm: venue.distanceKm, totalRooms: venue.hotel.totalRooms, expectedAttendance: e.expectedAttendance }) ??
          'low',
        description: `会場ページから抽出（確からしさ: ${e.confidence}）`,
        source: 'extracted',
        status: 'candidate',
        sourceRef: venue.websiteUrl,
        createdByUserId,
      },
    })
    created++
  }

  return { venueId, venueName: venue.name, url: venue.websiteUrl, truncated, extracted: events.length, created, skippedDuplicates, notes: result.notes }
}
