import { logger } from '../../utils/logger.js'
import { listActiveHotelsForJobService } from '../hotelsService.js'
import { loadStoredHolidays, refreshHolidays } from './holidays.js'
import { runWeatherForHotels } from './jmaWeather.js'

// 外部要因の取得ジョブ（D-13）。入口は jobs/external-signals.ts（コンテナでは `job external-signals`）。
// 1日1回、日次バッチ（job daily）の前に動かすと、その日の予測に新しい天気・イベントが入る。
// 取得元は3段:
//   1. 全国で1回: 祝日（内閣府）
//   2. 予報区ごとに1回: 天気（気象庁）
//   3. ホテルごと: 外部要因エージェント（周辺のイベント・新規ホテル・市場の動き。ANTHROPIC_API_KEY を設定したときだけ）
// 1つの取得元の失敗で他を止めない。失敗が1つでもあれば failed > 0（入口が終了コード 1 にする）。

export interface ExternalSignalStep {
  key: string
  run(): Promise<{ ok: boolean; summary: Record<string, unknown> }>
}

export type HotelForSignals = Awaited<ReturnType<typeof listActiveHotelsForJobService>>[number]

/** ホテルごとの段（エージェント）を足すための口。jobs/external-signals.ts が登録する */
export type HotelStepFactory = (hotels: HotelForSignals[]) => ExternalSignalStep | null

export function defaultSteps(hotels: HotelForSignals[]): ExternalSignalStep[] {
  return [
    {
      key: 'holidays',
      async run() {
        const r = await refreshHolidays()
        return { ok: true, summary: r }
      },
    },
    {
      key: 'weather',
      async run() {
        const r = await runWeatherForHotels(hotels)
        return { ok: r.failedAreas.length === 0, summary: { ...r } }
      },
    },
  ]
}

export async function runExternalSignalsJob(
  extraSteps: HotelStepFactory[] = []
): Promise<{ succeeded: number; failed: number }> {
  await loadStoredHolidays()
  const hotels = await listActiveHotelsForJobService()
  const steps = [...defaultSteps(hotels), ...extraSteps.map((f) => f(hotels)).filter((s): s is ExternalSignalStep => s != null)]
  let succeeded = 0
  let failed = 0
  for (const step of steps) {
    try {
      const { ok, summary } = await step.run()
      if (ok) succeeded++
      else failed++
      ;(ok ? logger.info.bind(logger) : logger.error.bind(logger))({ step: step.key, ...summary }, `外部要因の取得: ${step.key}`)
    } catch (error) {
      failed++
      logger.error({ step: step.key, err: error }, `外部要因の取得に失敗しました: ${step.key}`)
    }
  }
  logger.info({ hotels: hotels.length, succeeded, failed }, '外部要因の取得を終了しました')
  return { succeeded, failed }
}
