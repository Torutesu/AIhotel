import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import { config } from '../lib/config.js'
import { ApiError } from './errorHandler.js'

// Narrow capability for the operations BFF: usage reports/catalog only, not hotel APIs.
// Scope is derived from its verified cookie and server-side assignments, never browser claims.
export function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const key = config.OPERATIONS_USAGE_KEY
    if (!key) throw new ApiError(503, '本番活用状況の接続が設定されていません')
    const timestamp = req.get('x-usage-time') ?? ''
    const supplied = req.get('x-usage-signature') ?? ''
    if (!/^\d{13}$/.test(timestamp) || Math.abs(Date.now()-Number(timestamp)) > 30000 || !/^[a-f0-9]{64}$/.test(supplied)) throw new ApiError(401, '運営サーバーの認証が必要です')
    const expected = createHmac('sha256',key).update(`${timestamp}\n${req.method}\n${req.originalUrl}\n${JSON.stringify(req.body)}`).digest('hex')
    if (!timingSafeEqual(Buffer.from(expected),Buffer.from(supplied))) throw new ApiError(401, '運営サーバーの認証が必要です')
    next()
  } catch(error) { next(error) }
}
