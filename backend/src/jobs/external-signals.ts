import { logger } from '../utils/logger.js'
import { disconnectDatabase } from '../services/healthService.js'
import { runExternalSignalsJob } from '../services/externalSignals/job.js'

// 外部要因の取得（D-13）。コンテナでは `job external-signals`、開発時は `pnpm --filter backend job:external-signals`。
// 1日1回（02:30 JST 目安）、競合価格の取得・日次バッチより前に呼ぶ。失敗した取得元が1つでもあれば終了コード 1。

runExternalSignalsJob()
  .then(({ failed }) => {
    process.exitCode = failed > 0 ? 1 : 0
  })
  .catch((error) => {
    logger.error({ err: error }, '外部要因の取得ジョブが異常終了しました')
    process.exitCode = 1
  })
  .finally(async () => {
    await disconnectDatabase()
  })
