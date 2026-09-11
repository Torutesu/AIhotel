import { logger } from '../utils/logger.js'
import { todayJst } from '../lib/date.js'
import { listActiveHotelsForJobService } from '../services/hotelsService.js'
import { disconnectDatabase } from '../services/healthService.js'
import { createKpiSnapshotService } from '../services/dashboardService.js'
import { recomputeSimulationService } from '../services/pricingService.js'
import { recomputeForecastService } from '../services/forecast/forecastService.js'

// 日次バッチ（N-5）。開発時は `pnpm --filter backend job:daily`、
// 本番コンテナ（devDependencies を含まない）では `node dist/jobs/daily.js` で実行する。
//
// cron / スケジュールタスクから1日1回呼ばれることを想定した入口で、
// 有効な全ホテルに対して以下を順に実行する:
//   1. 需要予測の再計算（AiPriceRecommendation）
//   2. 月間着地シミュレーションの再計算（MonthlyLandingSimulation）
//   3. 当日時点の KPI スナップショット（KpiSnapshot — 月初比較・日付比較の比較元）
//
// 順序に意味がある: 着地シミュレーションは AI 予測を使うため、予測を先に更新する。
// いずれも冪等なので、同じ日に複数回実行しても行は増えない。
//
// 1ホテルの失敗で全体を止めない（1テナントの不整合が他テナントの更新を
// 巻き添えにしないため）。失敗はホテル単位で記録し、最後に件数を集計して
// 1件でも失敗していれば終了コード 1 で終わる（cron 側で検知できるようにする）。

interface HotelJobResult {
  hotelId: string
  hotelName: string
  forecastCount?: number
  simulationActualDays?: number
  error?: string
}

export async function runDailyJob(): Promise<{ succeeded: number; failed: number }> {
  const startedAt = Date.now()
  const today = todayJst()
  const year = today.getUTCFullYear()
  const month = today.getUTCMonth() + 1

  const hotels = await listActiveHotelsForJobService()
  logger.info({ hotels: hotels.length, targetYear: year, targetMonth: month }, '日次バッチを開始します')

  const results: HotelJobResult[] = []

  for (const hotel of hotels) {
    try {
      const forecast = await recomputeForecastService(hotel.id)
      const simulation = await recomputeSimulationService(hotel.id, year, month)
      await createKpiSnapshotService(hotel.id, year, month)

      results.push({
        hotelId: hotel.id,
        hotelName: hotel.name,
        forecastCount: forecast.count,
        simulationActualDays: simulation.actualDays,
      })
      logger.info(
        {
          hotelId: hotel.id,
          forecastCount: forecast.count,
          simulationActualDays: simulation.actualDays,
          simulationPredictedDays: simulation.predictedDays,
        },
        `${hotel.name}: 予測・着地・スナップショットを更新しました`
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      results.push({ hotelId: hotel.id, hotelName: hotel.name, error: message })
      logger.error({ err: error, hotelId: hotel.id }, `${hotel.name}: 日次バッチに失敗しました`)
    }
  }

  const failed = results.filter((r) => r.error).length
  const succeeded = results.length - failed

  logger.info(
    {
      succeeded,
      failed,
      durationMs: Date.now() - startedAt,
      failures: results.filter((r) => r.error).map((r) => ({ hotelId: r.hotelId, error: r.error })),
    },
    `日次バッチが完了しました（成功 ${succeeded} / 失敗 ${failed}）`
  )

  return { succeeded, failed }
}

runDailyJob()
  .then(({ failed }) => {
    process.exitCode = failed > 0 ? 1 : 0
  })
  .catch((error) => {
    logger.error({ err: error }, '日次バッチが異常終了しました')
    process.exitCode = 1
  })
  .finally(async () => {
    await disconnectDatabase()
  })
