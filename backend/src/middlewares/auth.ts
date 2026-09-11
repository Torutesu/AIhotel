import type { Request, Response, NextFunction } from 'express'
import type { UserRole } from '@prisma/client'
import { verifyAccessToken, JWTPayload } from '../lib/auth.js'
import { ApiError, NotFoundError } from './errorHandler.js'
import { findActiveHotelService } from '../services/hotelsService.js'

// Express Requestの拡張
declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload
      /** リクエスト相関 ID（utils/logger.ts の requestId ミドルウェアが採番 — C-8） */
      id?: string
    }
  }
}

/**
 * 認証が必要なエンドポイント用ミドルウェア
 */
export function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization
    
    if (!authHeader) {
      throw new ApiError(401, '認証が必要です')
    }
    
    const parts = authHeader.split(' ')
    
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      throw new ApiError(401, '無効な認証形式です')
    }
    
    const token = parts[1]
    const payload = verifyAccessToken(token)
    
    req.user = payload
    next()
  } catch (error) {
    if (error instanceof ApiError) {
      next(error)
    } else if (error instanceof Error) {
      next(new ApiError(401, error.message))
    } else {
      next(new ApiError(401, '認証に失敗しました'))
    }
  }
}

/**
 * 特定のロールが必要なエンドポイント用ミドルウェア
 * authenticate の後に使用すること
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new ApiError(401, '認証が必要です'))
    }
    
    if (!allowedRoles.includes(req.user.role)) {
      return next(new ApiError(403, 'この操作を行う権限がありません'))
    }
    
    next()
  }
}

/**
 * 特定のホテルへのアクセス権限をチェックするミドルウェア
 * authenticate の後に使用すること。
 * 論理削除（isActive=false）されたホテルへのアクセスはロールを問わず 404 にする（S-5）
 */
export function requireHotelAccess(hotelIdExtractor: (req: Request) => string | undefined) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new ApiError(401, '認証が必要です')
      }

      const requestedHotelId = hotelIdExtractor(req)

      // ADMINは全てのホテルにアクセス可能（hotelId 未指定は後段の zod 検証に任せる）
      if (req.user.role === 'ADMIN') {
        if (requestedHotelId && !(await findActiveHotelService(requestedHotelId))) {
          throw new NotFoundError('ホテル')
        }
        return next()
      }

      if (!requestedHotelId) {
        throw new ApiError(400, 'ホテルIDが必要です')
      }

      if (req.user.hotelId !== requestedHotelId) {
        throw new ApiError(403, 'このホテルへのアクセス権限がありません')
      }

      const hotel = await findActiveHotelService(requestedHotelId)
      if (!hotel) {
        throw new NotFoundError('ホテル')
      }

      // トークン発行後にユーザーのテナントが変わった等の不整合も拒否する
      if (req.user.tenantId !== hotel.tenantId) {
        throw new ApiError(403, 'このホテルへのアクセス権限がありません')
      }

      next()
    } catch (error) {
      next(error)
    }
  }
}

