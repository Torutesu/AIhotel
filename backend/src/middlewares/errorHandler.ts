import type { Request, Response, NextFunction } from 'express'
import { Prisma } from '@prisma/client'
import { ZodError } from 'zod'
import { config } from '../lib/config.js'
import { logger } from '../utils/logger.js'

// ======================================
// Custom Error Classes
// ======================================

export class ApiError extends Error {
  public statusCode: number
  public errors?: Array<{ field: string; message: string }>
  public isOperational: boolean

  constructor(
    statusCode: number,
    message: string,
    errors?: Array<{ field: string; message: string }>,
    isOperational = true
  ) {
    super(message)
    this.statusCode = statusCode
    this.errors = errors
    this.isOperational = isOperational
    
    // Maintains proper stack trace for where error was thrown
    Error.captureStackTrace(this, this.constructor)
  }
}

export class NotFoundError extends ApiError {
  constructor(resource = 'リソース') {
    super(404, `${resource}が見つかりません`)
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = '認証が必要です') {
    super(401, message)
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = 'この操作を行う権限がありません') {
    super(403, message)
  }
}

export class BadRequestError extends ApiError {
  constructor(message = '不正なリクエストです', errors?: Array<{ field: string; message: string }>) {
    super(400, message, errors)
  }
}

export class ConflictError extends ApiError {
  constructor(message = 'リソースが競合しています') {
    super(409, message)
  }
}

// ======================================
// API Response Interface
// ======================================

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  message?: string
  errors?: Array<{ field: string; message: string }>
  meta?: {
    page?: number
    limit?: number
    total?: number
    totalPages?: number
  }
}

// ======================================
// Error Handler Middleware
// ======================================

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  // Default error values
  let statusCode = 500
  let message = 'サーバーエラーが発生しました'
  let errors: Array<{ field: string; message: string }> | undefined
  let isOperational = false

  // Handle known error types
  if (err instanceof ApiError) {
    statusCode = err.statusCode
    message = err.message
    errors = err.errors
    isOperational = err.isOperational
  } else if (err instanceof ZodError) {
    statusCode = 400
    message = 'バリデーションエラー'
    errors = err.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    }))
    isOperational = true
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // 旧実装は「code が文字列の Error」を全て Prisma エラー扱いしていたため、
    // fs の ENOENT 等まで 400「データベースエラー」になっていた（S-2）。instanceof で厳密に判定する
    isOperational = true
    switch (err.code) {
      case 'P2002':
        statusCode = 409
        message = '既に存在するデータです'
        break
      case 'P2025':
        statusCode = 404
        message = 'データが見つかりません'
        break
      case 'P2003':
        statusCode = 400
        message = '関連するデータが存在しません'
        break
      default:
        statusCode = 400
        message = 'データベースエラーが発生しました'
    }
  } else if (err instanceof Prisma.PrismaClientValidationError) {
    statusCode = 400
    message = '入力データが不正です'
    isOperational = true
  }

  // Log the error。
  // req.headers / req.body をそのまま出力しない（Authorization・パスワード・リフレッシュトークンが
  // ログに残るため — S-2）。req は logger の serializer で安全なヘッダーのみに絞られ、
  // 万一含まれた場合も pino の redact でマスクされる
  if (!isOperational || statusCode >= 500) {
    logger.error({
      err,
      req,
      statusCode,
      message,
    }, message)
  } else {
    logger.warn({
      statusCode,
      message,
      errors,
      path: req.originalUrl,
      method: req.method,
    }, message)
  }

  // Send response
  const response: ApiResponse = {
    success: false,
    error: message,
    ...(errors && { errors }),
    ...(config.isDevelopment && !isOperational && {
      message: err.message,
      stack: err.stack,
    }),
  }

  res.status(statusCode).json(response)
}

// ======================================
// Async Handler Wrapper
// ======================================

type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<unknown>

/**
 * Expressのasync関数をラップしてエラーハンドリングを自動化
 */
export function asyncHandler(fn: AsyncRequestHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}
