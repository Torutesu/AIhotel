import { app } from './app.js'
import { config } from './lib/config.js'
import { logger } from './utils/logger.js'
import { disconnectDatabase } from './services/healthService.js'

// HTTP サーバーの起動とグレースフルシャットダウンのみを担当する（C-10）。
// Express アプリの組み立ては app.ts にあり、統合テストは listen せずに
// app を import できる。

const PORT = config.PORT

export const server = app.listen(PORT, () => {
  logger.info({
    port: PORT,
    env: config.NODE_ENV,
    frontend: config.FRONTEND_URL,
  }, `🚀 Backend server running on http://localhost:${PORT}`)
})

// Graceful shutdown
const SHUTDOWN_TIMEOUT_MS = 30_000
let shuttingDown = false

const gracefulShutdown = (signal: string) => {
  if (shuttingDown) return
  shuttingDown = true
  logger.info(`${signal} received. Starting graceful shutdown...`)

  server.close(async () => {
    logger.info('HTTP server closed')
    try {
      await disconnectDatabase()
      logger.info('Database connection closed')
    } catch (error) {
      logger.warn({ err: error }, 'DB 接続のクローズに失敗しました')
    }
    process.exit(0)
  })

  // keep-alive 接続が残っていると server.close() のコールバックが呼ばれないため、
  // 明示的に切断する（C-7）
  server.closeAllConnections()

  // Force close after 30 seconds。
  // unref() しておかないとこのタイマー自体がイベントループを生かし続け、
  // 正常に閉じ切ったあとも 30 秒プロセスが終わらない（C-7）
  const forceExit = setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down')
    process.exit(1)
  }, SHUTDOWN_TIMEOUT_MS)
  forceExit.unref()
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught Exception')
  process.exit(1)
})

process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason, promise }, 'Unhandled Rejection')
})
