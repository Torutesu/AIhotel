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
import { usersRouter } from './routes/users.js'
import { preferencesRouter } from './routes/preferences.js'

// Import middlewares
import { errorHandler } from './middlewares/errorHandler.js'
import { notFoundHandler } from './middlewares/notFoundHandler.js'

// Import utilities
import { requestId, requestLogger } from './utils/logger.js'
import { verifyAccessToken } from './lib/auth.js'
import { checkDatabaseConnection } from './services/healthService.js'

// Express アプリの組み立てのみを行う（C-10）。
// listen とグレースフルシャットダウンは server.ts が担当する。
// こうすることで supertest 等から listen せずに app を import できる。

const NODE_ENV = config.NODE_ENV

const app: ReturnType<typeof express> = express()

// リバースプロキシ配下では X-Forwarded-For を信頼しないと req.ip が全てプロキシの IP になり、
// レートリミットが全ユーザーで共有されてしまう（S-3）
app.set('trust proxy', config.TRUST_PROXY)

export const HEALTH_CHECK_PATHS = new Set(['/health', '/api/health'])

/**
 * レートリミットのキー（S-3）。
 * 認証済みなら userId 単位、未認証なら IP 単位でカウントする。
 * リミッターは authenticate より前段で動くため、Bearer トークンをここで検証して userId を取り出す
 * （DB アクセスなし。無効なトークンなら IP にフォールバックし、認証エラー自体は後段に任せる）。
 */
function rateLimitKey(req: express.Request): string {
  const authHeader = req.headers.authorization
  if (authHeader?.startsWith('Bearer ')) {
    try {
      return `user:${verifyAccessToken(authHeader.slice('Bearer '.length)).userId}`
    } catch {
      // 無効・期限切れトークンは IP 単位にフォールバック
    }
  }
  return `ip:${req.ip ?? 'unknown'}`
}

// Rate limiter configuration
const limiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS, // 15 minutes
  max: config.RATE_LIMIT_MAX_REQUESTS,
  keyGenerator: rateLimitKey,
  // ヘルスチェック（監視系のポーリング）はレートリミットの対象外（S-3 / C-7）
  skip: (req) => HEALTH_CHECK_PATHS.has(req.originalUrl.split('?')[0]),
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

// Security middleware
app.use(helmet({
  contentSecurityPolicy: NODE_ENV === 'production',
}))

// CORS configuration
// FRONTEND_URL はカンマ区切りで複数指定できる（S-10）。開発時のみ localhost を暗黙で追加する。
// 認証は Cookie ではなく Authorization: Bearer なので credentials は不要（S-10）
const ALLOWED_ORIGINS = NODE_ENV === 'production'
  ? config.FRONTEND_URL
  : [...new Set([...config.FRONTEND_URL, 'http://localhost:3000', 'http://127.0.0.1:3000'])]

app.use(cors({
  origin: ALLOWED_ORIGINS,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))

// Rate limiting
app.use('/api/', limiter)

// Body parsing
// 業務上のリクエストは日別データの一括更新でも数百KB程度。10mb は DoS 面を広げるだけなので 1mb にする（S-10）
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true, limit: '1mb' }))

// Request correlation id + logging（C-8）。requestId は requestLogger より前に置く
app.use(requestId())
app.use(requestLogger())

// ======================================
// Health Check Endpoints
// ======================================

/**
 * ヘルスチェック（C-7）。DB へ `SELECT 1` を投げ、到達できなければ 503 を返す。
 * ロードバランサ・コンテナオーケストレータはこれを見て流入を止められる。
 * レートリミットの対象外（HEALTH_CHECK_PATHS）。
 */
const healthHandler = async (_req: express.Request, res: express.Response) => {
  const databaseHealthy = await checkDatabaseConnection()
  const status = databaseHealthy ? 'ok' : 'degraded'

  res.status(databaseHealthy ? 200 : 503).json({
    success: databaseHealthy,
    ...(databaseHealthy ? {} : { error: 'データベースに接続できません' }),
    data: {
      status,
      timestamp: new Date().toISOString(),
      environment: NODE_ENV,
      version: config.appVersion,
      services: {
        api: 'healthy',
        database: databaseHealthy ? 'healthy' : 'unhealthy',
      },
    },
  })
}

app.get('/health', healthHandler)
app.get('/api/health', healthHandler)

// ======================================
// API Routes
// ======================================

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
app.use('/api/v1/users', usersRouter)
app.use('/api/v1/preferences', preferencesRouter)

// ======================================
// Error Handling
// ======================================

// 404 handler - must be after all routes
app.use(notFoundHandler)

// Global error handler - must be last
app.use(errorHandler)

export { app }
export default app
