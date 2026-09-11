import { app } from './app.js'
import { config } from './lib/config.js'
import { logger } from './utils/logger.js'

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

  server.close(() => {
    logger.info('HTTP server closed')
    process.exit(0)
  })

  // Force close after 30 seconds
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
