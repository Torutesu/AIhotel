import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import dotenv from 'dotenv'

// Load environment variables first
dotenv.config()

// Import routes
import { authRouter } from './routes/auth.js'
import { hotelsRouter } from './routes/hotels.js'
import { dashboardRouter } from './routes/dashboard.js'
import { pricingRouter } from './routes/pricing.js'
import { dailyRouter } from './routes/daily.js'
import { analysisRouter } from './routes/analysis.js'
import { settingsRouter } from './routes/settings.js'

// Import middlewares
import { errorHandler } from './middlewares/errorHandler.js'
import { notFoundHandler } from './middlewares/notFoundHandler.js'

// Import utilities
import { logger, requestLogger } from './utils/logger.js'

// ======================================
// Configuration
// ======================================

const app: ReturnType<typeof express> = express()
const PORT = process.env.PORT || 3001
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000'
const NODE_ENV = process.env.NODE_ENV || 'development'

// Rate limiter configuration
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
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
app.use(cors({
  origin: NODE_ENV === 'production' 
    ? FRONTEND_URL 
    : [FRONTEND_URL, 'http://localhost:3000', 'http://127.0.0.1:3000'],
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
      version: process.env.npm_package_version || '1.0.0',
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

// API v1 routes
app.use('/api/v1/auth', authRouter)
app.use('/api/v1/hotels', hotelsRouter)
app.use('/api/v1/dashboard', dashboardRouter)
app.use('/api/v1/pricing', pricingRouter)
app.use('/api/v1/daily', dailyRouter)
app.use('/api/v1/analysis', analysisRouter)
app.use('/api/v1/settings', settingsRouter)

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
