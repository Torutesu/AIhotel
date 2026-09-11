import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { config } from '../lib/config.js'

const LOG_LEVEL = config.LOG_LEVEL
const LOG_FORMAT = config.LOG_FORMAT
const IS_DEVELOPMENT = config.isDevelopment

// 機微情報のマスク（S-2）。誤ってリクエスト全体やボディをログに渡しても
// 認証情報・パスワード・トークンが平文で残らないようにする
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'req.body.password',
  'req.body.refreshToken',
  'headers.authorization',
  'headers.cookie',
  'body.password',
  'body.refreshToken',
  '*.password',
  '*.refreshToken',
  '*.accessToken',
  '*.authorization',
  '*.cookie',
]

// Pinoロガーの設定
const pinoOptions: pino.LoggerOptions = {
  level: LOG_LEVEL,
  // 本番環境ではタイムスタンプをISOフォーマットで出力
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  // エラーオブジェクトのシリアライズ設定
  serializers: {
    err: pino.stdSerializers.err,
    // Express の Request をそのまま渡しても安全なヘッダーだけに絞る（Authorization/Cookie は出さない）
    req: (req) => ({
      id: req.id,
      method: req.method,
      // ルーター配下では req.url からマウント先のプレフィックスが落ちる（C-8）
      url: req.originalUrl ?? req.url,
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

// リクエスト相関 ID のヘッダー名（C-8）
export const REQUEST_ID_HEADER = 'x-request-id'

// クライアントが送ってきた値をそのままログに載せないよう、長さと文字種を制限する
const MAX_REQUEST_ID_LENGTH = 128
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]+$/

/**
 * リクエスト相関 ID を採番するミドルウェア（C-8）。
 *
 * 受信した x-request-id が使える形式ならそれを引き継ぎ（ロードバランサや
 * フロントエンドが採番したトレース ID をそのまま使えるようにする）、
 * 無ければ生成する。いずれの場合もレスポンスヘッダーに echo back し、
 * リクエストログ・エラーログの両方に含める。
 */
export function requestId() {
  return (req: any, res: any, next: () => void) => {
    const incoming = req.headers?.[REQUEST_ID_HEADER]
    const candidate = Array.isArray(incoming) ? incoming[0] : incoming
    const id =
      typeof candidate === 'string' &&
      candidate.length > 0 &&
      candidate.length <= MAX_REQUEST_ID_LENGTH &&
      SAFE_REQUEST_ID.test(candidate)
        ? candidate
        : randomUUID()

    req.id = id
    res.setHeader(REQUEST_ID_HEADER, id)
    next()
  }
}

// HTTPリクエストログ用ミドルウェア
export function requestLogger() {
  return (req: any, res: any, next: () => void) => {
    const startTime = Date.now()

    // レスポンス完了時にログ出力
    res.on('finish', () => {
      const duration = Date.now() - startTime
      const logData = {
        requestId: req.id,
        method: req.method,
        // req.url はルーターにマウントされた時点でプレフィックスが落ちるため
        // （/api/v1/events/:id が /:id になる）、必ず originalUrl を使う（C-8）
        url: req.originalUrl ?? req.url,
        statusCode: res.statusCode,
        duration: `${duration}ms`,
        userAgent: req.headers['user-agent'],
        ip: req.ip || req.socket?.remoteAddress,
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
