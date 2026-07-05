import pino from 'pino'
import { config } from '../lib/config.js'

const LOG_LEVEL = config.LOG_LEVEL
const LOG_FORMAT = config.LOG_FORMAT
const IS_DEVELOPMENT = config.isDevelopment

// Pinoロガーの設定
const pinoOptions: pino.LoggerOptions = {
  level: LOG_LEVEL,
  // 本番環境ではタイムスタンプをISOフォーマットで出力
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
  // エラーオブジェクトのシリアライズ設定
  serializers: {
    err: pino.stdSerializers.err,
    req: (req) => ({
      method: req.method,
      url: req.url,
      path: req.path,
      headers: {
        host: req.headers?.host,
        'user-agent': req.headers?.['user-agent'],
        'content-type': req.headers?.['content-type'],
      },
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
  },
  // ベース情報
  base: {
    service: 'hotel-revenue-backend',
    env: config.NODE_ENV,
  },
}

// 開発環境ではpino-prettyを使用して見やすく整形
const transport = IS_DEVELOPMENT && LOG_FORMAT !== 'json'
  ? {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    }
  : undefined

// Pinoロガーのインスタンス作成
const pinoLogger = transport
  ? pino(pinoOptions, pino.transport(transport))
  : pino(pinoOptions)

// ======================================
// Logger Interface
// ======================================

interface LogMeta {
  [key: string]: unknown
}

export const logger = {
  /**
   * 致命的なエラーをログ出力
   */
  fatal: (meta: LogMeta | string, message?: string) => {
    if (typeof meta === 'string') {
      pinoLogger.fatal(meta)
    } else {
      pinoLogger.fatal(meta, message)
    }
  },

  /**
   * エラーをログ出力
   */
  error: (meta: LogMeta | string | Error, message?: string) => {
    if (typeof meta === 'string') {
      pinoLogger.error(meta)
    } else if (meta instanceof Error) {
      pinoLogger.error({ err: meta }, message || meta.message)
    } else {
      pinoLogger.error(meta, message)
    }
  },

  /**
   * 警告をログ出力
   */
  warn: (meta: LogMeta | string, message?: string) => {
    if (typeof meta === 'string') {
      pinoLogger.warn(meta)
    } else {
      pinoLogger.warn(meta, message)
    }
  },

  /**
   * 情報をログ出力
   */
  info: (meta: LogMeta | string, message?: string) => {
    if (typeof meta === 'string') {
      pinoLogger.info(meta)
    } else {
      pinoLogger.info(meta, message)
    }
  },

  /**
   * デバッグ情報をログ出力
   */
  debug: (meta: LogMeta | string, message?: string) => {
    if (typeof meta === 'string') {
      pinoLogger.debug(meta)
    } else {
      pinoLogger.debug(meta, message)
    }
  },

  /**
   * トレース情報をログ出力
   */
  trace: (meta: LogMeta | string, message?: string) => {
    if (typeof meta === 'string') {
      pinoLogger.trace(meta)
    } else {
      pinoLogger.trace(meta, message)
    }
  },

  /**
   * 子ロガーを作成
   */
  child: (bindings: pino.Bindings) => {
    return pinoLogger.child(bindings)
  },
}

// HTTPリクエストログ用ミドルウェア
export function requestLogger() {
  return (req: any, res: any, next: () => void) => {
    const startTime = Date.now()
    
    // レスポンス完了時にログ出力
    res.on('finish', () => {
      const duration = Date.now() - startTime
      const logData = {
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
        duration: `${duration}ms`,
        userAgent: req.headers['user-agent'],
        ip: req.ip || req.connection?.remoteAddress,
      }
      
      if (res.statusCode >= 500) {
        logger.error(logData, 'Request failed')
      } else if (res.statusCode >= 400) {
        logger.warn(logData, 'Request error')
      } else {
        logger.info(logData, 'Request completed')
      }
    })
    
    next()
  }
}

export default logger
