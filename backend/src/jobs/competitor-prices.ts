import { logger } from '../utils/logger.js'
import { disconnectDatabase } from '../services/healthService.js'
import { runCompetitorPricesJob } from '../services/competitorRates/job.js'

// 競合価格の定期取得（#9 段階B）。コンテナでは `job competitor-prices`、開発時は `pnpm --filter backend job:competitor-prices`。
// 1日1回（03:00 JST 目安）スケジューラから呼ぶ。日次バッチ（job daily）より前に終わらせると、その日の推奨に反映される。
// 失敗した取得元が1つでもあれば終了コード 1（スケジューラで検知する）。

runCompetitorPricesJob()
  .then(({ failed }) => {
    process.exitCode = failed > 0 ? 1 : 0
  })
  .catch((error) => {
    logger.error({ err: error }, '競合価格の取得ジョブが異常終了しました')
    process.exitCode = 1
  })
  .finally(async () => {
    await disconnectDatabase()
  })
