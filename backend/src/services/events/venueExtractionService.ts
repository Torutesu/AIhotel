// 会場ページを取得し、LLM（Anthropic Claude または OpenAI GPT、services/llm/ で切替）の構造化出力で
// イベント候補を抽出して Event（status=candidate, source=extracted）に保存する。
// 選択したプロバイダの API キーが無ければ 400 を返す（docs/外部要因設計.md §3 #3 b）。
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
import { getLlmProviderForHotel, type LlmSelection } from '../llm/llmService.js'
import type { LlmProvider, LlmProviderName } from '../llm/types.js'

export interface VenueExtractor {
  extract(params: { venueName: string; url: string; asOfDate: string; pageText: string }): Promise<ExtractionResult>
}

const MAX_OUTPUT_TOKENS = 16000

/**
 * LLM プロバイダ（Claude / GPT）を使う抽出器
 */
export function createLlmExtractor(provider: LlmProvider): VenueExtractor {
  return {
    async extract(params) {
      const res = await provider.generateStructured({
        system: EXTRACTION_SYSTEM_PROMPT,
        user: buildExtractionUserMessage(params),
        schema: ExtractionResultSchema,
        schemaName: 'venue_events',
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      })
      logger.info({ provider: res.provider, model: res.model, usage: res.usage }, '会場ページからイベントを抽出しました')
      return res.parsed
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
  /** 実際に使った LLM（プロバイダ・モデル・選択の出どころ） */
  llm: LlmSelection | null
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
  fetchPage: (url: string) => Promise<string> = fetchVenuePage,
  llmOverride?: { provider?: LlmProviderName; model?: string }
): Promise<ExtractVenueEventsResult> {
  const venue = await prisma.venue.findFirst({ where: { id: venueId, hotelId }, include: { hotel: { select: { totalRooms: true } } } })
  if (!venue) throw new NotFoundError('会場')
  if (!venue.websiteUrl) throw new BadRequestError('会場にイベントカレンダーのURLが設定されていません')

  let ext = extractor
  let llm: LlmSelection | null = null
  if (!ext) {
    const { provider, selection } = await getLlmProviderForHotel(hotelId, llmOverride)
    ext = createLlmExtractor(provider)
    llm = selection
  }
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

  return { venueId, venueName: venue.name, url: venue.websiteUrl, truncated, extracted: events.length, created, skippedDuplicates, notes: result.notes, llm }
}
