import { prisma } from '../../../lib/prisma.js'
import { config } from '../../../lib/config.js'
import { todayJst } from '../../../lib/date.js'
import { logger } from '../../../utils/logger.js'
import type { ExternalSignalStep, HotelForSignals } from '../job.js'
import { collectExternalFactors, createAgentClient, type MessagesClient } from './collect.js'
import { saveAgentFindings } from './save.js'

// 外部要因ジョブのホテルごとの段（D-13）。ANTHROPIC_API_KEY が無ければ段ごと外す（何もしない）。
// 同じホテルは EXTERNAL_AGENT_INTERVAL_DAYS 日に1回だけ集める（Web 検索とトークンの費用を抑える）。
// 実行ごとに ExternalAgentRun を残す（検索回数・トークン数・保存件数・失敗の理由）。

const DAY_MS = 86_400_000

export async function runAgentForHotel(
  client: MessagesClient,
  hotel: HotelForSignals,
  now: Date = new Date()
): Promise<'skipped' | 'succeeded' | 'failed'> {
  const recent = await prisma.externalAgentRun.findFirst({
    where: {
      hotelId: hotel.id,
      status: 'succeeded',
      startedAt: { gte: new Date(now.getTime() - config.EXTERNAL_AGENT_INTERVAL_DAYS * DAY_MS) },
    },
    select: { id: true },
  })
  if (recent) return 'skipped'

  const run = await prisma.externalAgentRun.create({
    data: { tenantId: hotel.tenantId, hotelId: hotel.id, model: config.EXTERNAL_AGENT_MODEL, startedAt: now },
  })
  try {
    const collected = await collectExternalFactors(client, hotel, todayJst(now))
    const saved = await saveAgentFindings(hotel, collected.findings)
    await prisma.externalAgentRun.update({
      where: { id: run.id },
      data: {
        status: 'succeeded',
        finishedAt: new Date(),
        model: collected.model,
        webSearches: collected.webSearches,
        inputTokens: collected.inputTokens,
        outputTokens: collected.outputTokens,
        eventsSaved: saved.events,
        openingsSaved: saved.openings,
        signalsSaved: saved.signals,
      },
    })
    logger.info({ hotelId: hotel.id, ...saved, dropped: collected.dropped, webSearches: collected.webSearches }, '外部要因エージェント: 保存しました')
    return 'succeeded'
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await prisma.externalAgentRun.update({
      where: { id: run.id },
      data: { status: 'failed', finishedAt: new Date(), errorMessage: message.slice(0, 1000) },
    })
    logger.error({ hotelId: hotel.id, error: message }, '外部要因エージェントが失敗しました')
    return 'failed'
  }
}

export function externalAgentStep(hotels: HotelForSignals[], client: MessagesClient | null = createAgentClient()): ExternalSignalStep | null {
  if (!client) return null
  return {
    key: 'agent',
    async run() {
      const counts = { succeeded: 0, skipped: 0, failed: 0 }
      for (const hotel of hotels) counts[await runAgentForHotel(client, hotel)]++
      return { ok: counts.failed === 0, summary: counts }
    },
  }
}
