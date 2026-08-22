import type { Request, Response, NextFunction } from 'express'
import type { AgentDevice } from '@prisma/client'
import { ApiError } from './errorHandler.js'
import { findActiveDeviceByToken, touchDevice } from '../services/agentDeviceService.js'

// コネクタエージェント用のデバイストークン認証（docs/コネクタ連携設計.md §5）。
// ユーザーJWT（middlewares/auth.ts）とは別系統で、スコープは hotel 単位。
// トークンはDBに SHA-256 ハッシュのみ保存されており、失効（revokedAt）は即時反映される。

declare global {
  namespace Express {
    interface Request {
      agentDevice?: AgentDevice
    }
  }
}

/**
 * デバイストークン認証ミドルウェア。
 * 認証成功時は req.agentDevice を設定し、lastSeenAt を更新する（デッドマン検知の基準）。
 */
export function authenticateDevice(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization
  if (!authHeader) {
    next(new ApiError(401, 'デバイス認証が必要です'))
    return
  }
  const parts = authHeader.split(' ')
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    next(new ApiError(401, '無効な認証形式です'))
    return
  }

  findActiveDeviceByToken(parts[1])
    .then(async (device) => {
      if (!device) {
        next(new ApiError(401, 'デバイストークンが無効か失効しています'))
        return
      }
      req.agentDevice = device
      await touchDevice(device)
      next()
    })
    .catch(next)
}
