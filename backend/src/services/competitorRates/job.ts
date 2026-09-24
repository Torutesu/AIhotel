import { logger } from '../../utils/logger.js'
import { listActiveHotelsForJobService } from '../hotelsService.js'
import { fetchCompetitorRatesForHotel, type HotelFetchResult } from './fetchService.js'
import { competitorRateSources } from './sources.js'
import type { CompetitorRateSource } from './types.js'

// 競合価格の定期取得ジョブの本体（#9 段階B）。入口は jobs/competitor-prices.ts。
// 失敗した取得元が1つでもあれば failed > 0 を返す（入口が終了コード 1 にする）。
// 同じ取得元が2回続けて失敗したらエラーログに「連続失敗」と出す（運営に通知する — #9 §4）。

export async function runCompetitorPricesJob(
  sources: CompetitorRateSource[] = competitorRateSources
): Promise<{ succeeded: number; failed: number }> {
  if (sources.length === 0) {
    logger.info('競合価格の取得元が登録されていないため、何もせずに終了します（CSV の取り込みで運用中）')
    return { succeeded: 0, failed: 0 }
  }

  const hotels = await listActiveHotelsForJobService()
  const results: HotelFetchResult[] = []
  for (const hotel of hotels) {
    try {
      results.push(...(await fetchCompetitorRatesForHotel(hotel.id, sources)))
    } catch (error) {
      logger.error({ hotelId: hotel.id, err: error }, '競合価格の取得でホテル単位の失敗がありました')
      results.push({ hotelId: hotel.id, source: '*', status: 'failed', observations: 0, alerts: 0, consecutiveFailure: false })
    }
  }

  for (const r of results.filter((r) => r.status === 'failed')) {
    logger.error(
      { hotelId: r.hotelId, source: r.source, error: r.errorMessage },
      r.consecutiveFailure ? '競合価格の取得が連続失敗しています（取得処理の修正が必要）' : '競合価格の取得に失敗しました'
    )
  }
  const summary = {
    succeeded: results.filter((r) => r.status === 'succeeded').length,
    failed: results.filter((r) => r.status === 'failed').length,
  }
  logger.info(
    {
      ...summary,
      observations: results.reduce((s, r) => s + r.observations, 0),
      priceMoveAlerts: results.reduce((s, r) => s + r.alerts, 0),
    },
    '競合価格の取得を終了しました'
  )
  return summary
}
