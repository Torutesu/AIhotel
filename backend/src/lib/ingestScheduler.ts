import { config } from './config.js'
import { logger } from '../utils/logger.js'
import { runIngestConnectorsService } from '../services/ingestRunnerService.js'

// ======================================
// 取込スケジューラ（docs/pms-ingest-design.md §A-3）
//
// バックエンド常駐プロセスが自分でデータを取りに行くための起床タイマー。
// クラウドが未確定（AWS EventBridge / Cloud Scheduler 等）のため、
// まずはプロセス内タイマーで動かし、外部スケジューラへ移す場合も
// POST /api/v1/ingest/run を叩くだけで同じ処理を再利用できるようにしてある。
//
// 注意: 複数インスタンスで動かす場合はこのタイマーを止め（INGEST_SCHEDULER_ENABLED=false）、
// 外部スケジューラから1本だけ叩くこと。二重起動の排他はまだ持っていない。
// ======================================

let timer: NodeJS.Timeout | null = null
let running = false

async function tick(): Promise<void> {
  // 前回の実行が長引いている場合は重ねて走らせない
  if (running) {
    logger.warn('前回の自動取込がまだ実行中のため、今回の起床はスキップします')
    return
  }
  running = true
  try {
    await runIngestConnectorsService({})
  } catch (error) {
    logger.error({ err: error }, '自動取込の実行中にエラーが発生しました')
  } finally {
    running = false
  }
}

export function startIngestScheduler(): void {
  if (!config.INGEST_SCHEDULER_ENABLED) {
    logger.info('自動取込スケジューラは無効です（INGEST_SCHEDULER_ENABLED=false）')
    return
  }
  if (timer) return

  const intervalMs = config.INGEST_SCHEDULER_INTERVAL_MS
  timer = setInterval(() => {
    void tick()
  }, intervalMs)
  // 常駐タイマーがプロセスの終了を妨げないようにする
  timer.unref()

  logger.info({ intervalMs }, '自動取込スケジューラを開始しました')
  void tick()
}

export function stopIngestScheduler(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
