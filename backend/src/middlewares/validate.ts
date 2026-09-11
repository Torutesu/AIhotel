import type { Request, Response, NextFunction } from 'express'
import { ZodSchema, ZodError } from 'zod'
import { ApiError } from './errorHandler.js'

type ValidateTarget = 'body' | 'query' | 'params'

/**
 * Zodスキーマを使用してリクエストを検証するミドルウェア
 * @param schema - Zodスキーマ
 * @param target - 検証対象（body, query, params）
 */
export function validate<T>(
  schema: ZodSchema<T>,
  target: ValidateTarget = 'body'
) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const data = req[target]
      const validated = await schema.parseAsync(data)

      // 検証後のデータで上書き（型変換が適用される）。
      // req.query / req.params は Express の型が固定されているため、
      // any を使わずに書き込み可能な形へ絞ってから代入する（C-11）
      ;(req as unknown as Record<ValidateTarget, unknown>)[target] = validated

      next()
    } catch (error) {
      if (error instanceof ZodError) {
        const formattedErrors = error.errors.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        }))
        
        next(new ApiError(400, 'バリデーションエラー', formattedErrors))
      } else {
        next(error)
      }
    }
  }
}
