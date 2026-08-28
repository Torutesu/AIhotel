import type { Request, Response, NextFunction } from 'express'
import type { UserRole } from '@prisma/client'
import { verifyAccessToken, JWTPayload } from '../lib/auth.js'
import { ApiError } from './errorHandler.js'

// Express Requestの拡張
declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload
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
 * オプショナル認証ミドルウェア
 * トークンがあれば検証するが、なくてもエラーにしない
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization
    
    if (!authHeader) {
      return next()
    }
    
    const parts = authHeader.split(' ')
    
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return next()
    }
    
    const token = parts[1]
    const payload = verifyAccessToken(token)
    
    req.user = payload
    next()
  } catch {
    // エラーがあっても無視して続行
    next()
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
 * authenticate の後に使用すること
 */
export function requireHotelAccess(hotelIdExtractor: (req: Request) => string | undefined) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new ApiError(401, '認証が必要です'))
    }
    
    // ADMINは全てのホテルにアクセス可能
    if (req.user.role === 'ADMIN') {
      return next()
    }
    
    const requestedHotelId = hotelIdExtractor(req)
    
    if (!requestedHotelId) {
      return next(new ApiError(400, 'ホテルIDが必要です'))
    }
    
    if (req.user.hotelId !== requestedHotelId) {
      return next(new ApiError(403, 'このホテルへのアクセス権限がありません'))
    }
    
    next()
  }
}

/**
 * 自分自身のリソースかどうかをチェックするミドルウェア
 */
export function requireSelfOrAdmin(userIdExtractor: (req: Request) => string | undefined) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new ApiError(401, '認証が必要です'))
    }
    
    // ADMINは全てのユーザーにアクセス可能
    if (req.user.role === 'ADMIN') {
      return next()
    }
    
    const requestedUserId = userIdExtractor(req)
    
    if (req.user.userId !== requestedUserId) {
      return next(new ApiError(403, 'このリソースへのアクセス権限がありません'))
    }
    
    next()
  }
}

/**
 * システム提供側の ADMIN（どのテナントにも属さない）だけを通す。
 *
 * テナント作成・一覧・解約はテナントを横断する操作のため、
 * 顧客側に配置された ADMIN（tenantId を持つ）には許可しない。
 * authenticate と requireRole('ADMIN') の後に使うこと。
 */
export function requireProviderAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) {
    return next(new ApiError(401, '認証が必要です'))
  }
  if (req.user.role !== 'ADMIN' || req.user.tenantId !== null) {
    return next(new ApiError(403, 'この操作はシステム提供側の管理者のみ実行できます'))
  }
  next()
}
