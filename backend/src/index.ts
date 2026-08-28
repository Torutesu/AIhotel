import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'

// 環境変数の読み込み・検証は lib/config.ts が import 時に行う
// （ESM の import hoisting により、ここで dotenv.config() を呼んでも間に合わない）
import { config } from './lib/config.js'

// Import routes
import { authRouter } from './routes/auth.js'
import { hotelsRouter } from './routes/hotels.js'
import { dashboardRouter } from './routes/dashboard.js'
import { pricingRouter } from './routes/pricing.js'
import { dailyRouter } from './routes/daily.js'
import { analysisRouter } from './routes/analysis.js'
import { settingsRouter } from './routes/settings.js'
import { eventsRouter } from './routes/events.js'
import { reportsRouter } from './routes/reports.js'
import { adminRouter } from './routes/admin.js'

// Import middlewares
import { errorHandler } from './middlewares/errorHandler.js'
import { tenantContext } from './middlewares/tenantContext.js'
import { notFoundHandler } from './middlewares/notFoundHandler.js'

// Import utilities
import { logger, requestLogger } from './utils/logger.js'
import { isAllowedOrigin } from './lib/tenantResolver.js'

// ======================================
// Configuration
// ======================================

const app: ReturnType<typeof express> = express()
const PORT = config.PORT
const FRONTEND_URL = config.FRONTEND_URL
const NODE_ENV = config.NODE_ENV

// Rate limiter configuration
const limiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS, // 15 minutes
  max: config.RATE_LIMIT_MAX_REQUESTS,
  message: {
    success: false,
    error: 'リクエスト数の上限に達しました。しばらくしてから再度お試しください。',
  },
  standardHeaders: true,
  legacyHeaders: false,
})

// ======================================
// Middleware Setup
// ======================================

// Cloud Run 等のリバースプロキシ配下では、クライアントIPとホスト名が
// X-Forwarded-* ヘッダーで渡る。これを信頼しないと
// レート制限が全リクエストを同一IPとみなし、サブドメインによる
// テナント判定（D-08）も効かなくなる。
// 直近1ホップ（ロードバランサ）のみを信頼する
if (NODE_ENV === 'production') {
  app.set('trust proxy', 1)
}

// Security middleware
app.use(helmet({
  contentSecurityPolicy: NODE_ENV === 'production',
}))

// CORS configuration
// テナントごとのサブドメイン（D-08）を許可するため、オリジンは動的に判定する。
// ベースドメイン配下の1段サブドメインのみを通し、詐称ドメインは弾く
const explicitOrigins = NODE_ENV === 'production'
  ? [FRONTEND_URL]
  : [FRONTEND_URL, 'http://localhost:3000', 'http://127.0.0.1:3000']

app.use(cors({
  origin(origin, callback) {
    // 同一オリジン・サーバー間通信など Origin を持たないリクエストは許可する
    if (!origin) return callback(null, true)
    if (isAllowedOrigin(origin, config.APP_BASE_DOMAIN, explicitOrigins)) {
      return callback(null, true)
    }
    callback(new Error('CORS: 許可されていないオリジンです'))
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))

// Rate limiting
app.use('/api/', limiter)

// Body parsing
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// Request logging
app.use(requestLogger())

// ======================================
// Health Check Endpoints
// ======================================

app.get('/health', (_req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: NODE_ENV,
      version: config.appVersion,
    },
  })
})

app.get('/api/health', (_req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {
        api: 'healthy',
        // database: 'healthy', // TODO: Add DB health check
      },
    },
  })
})

// ======================================
// API Routes
// ======================================

// テナント分離（RLS）のコンテキストを張る。全 v1 ルートの前に置くこと（D-01）
app.use('/api/v1', tenantContext)

// API v1 routes
app.use('/api/v1/auth', authRouter)
app.use('/api/v1/hotels', hotelsRouter)
app.use('/api/v1/dashboard', dashboardRouter)
app.use('/api/v1/pricing', pricingRouter)
app.use('/api/v1/daily', dailyRouter)
app.use('/api/v1/analysis', analysisRouter)
app.use('/api/v1/settings', settingsRouter)
app.use('/api/v1/events', eventsRouter)
app.use('/api/v1/reports', reportsRouter)
app.use('/api/v1/admin', adminRouter)

// ======================================
// Error Handling
// ======================================

// 404 handler - must be after all routes
app.use(notFoundHandler)

// Global error handler - must be last
app.use(errorHandler)

// ======================================
// Server Startup
// ======================================

const server = app.listen(PORT, () => {
  logger.info({
    port: PORT,
    env: NODE_ENV,
    frontend: FRONTEND_URL,
  }, `🚀 Backend server running on http://localhost:${PORT}`)
})

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  logger.info(`${signal} received. Starting graceful shutdown...`)
  
  server.close(() => {
    logger.info('HTTP server closed')
    process.exit(0)
  })

  // Force close after 30 seconds
  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down')
    process.exit(1)
  }, 30000)
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

export default app
