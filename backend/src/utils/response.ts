import type { Response } from 'express'
import type { ApiResponse } from '../middlewares/errorHandler.js'

/**
 * 成功レスポンスを送信する
 */
export function sendSuccess<T>(
  res: Response,
  data: T,
  statusCode = 200,
  message?: string
): void {
  const response: ApiResponse<T> = {
    success: true,
    data,
    ...(message && { message }),
  }
  res.status(statusCode).json(response)
}

/**
 * ページネーション付き成功レスポンスを送信する
 */
export function sendPaginatedSuccess<T>(
  res: Response,
  data: T[],
  pagination: {
    page: number
    limit: number
    total: number
  },
  statusCode = 200
): void {
  const totalPages = Math.ceil(pagination.total / pagination.limit)
  
  const response: ApiResponse<T[]> = {
    success: true,
    data,
    meta: {
      page: pagination.page,
      limit: pagination.limit,
      total: pagination.total,
      totalPages,
    },
  }
  res.status(statusCode).json(response)
}

/**
 * 作成成功レスポンスを送信する
 */
export function sendCreated<T>(res: Response, data: T, message = '作成しました'): void {
  sendSuccess(res, data, 201, message)
}

/**
 * 更新成功レスポンスを送信する
 */
export function sendUpdated<T>(res: Response, data: T, message = '更新しました'): void {
  sendSuccess(res, data, 200, message)
}

/**
 * 削除成功レスポンスを送信する
 */
export function sendDeleted(res: Response, message = '削除しました'): void {
  const response: ApiResponse = {
    success: true,
    message,
  }
  res.status(200).json(response)
}

/**
 * No Content レスポンスを送信する
 */
export function sendNoContent(res: Response): void {
  res.status(204).send()
}
