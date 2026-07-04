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
      
      // 検証後のデータで上書き（型変換が適用される）
      req[target] = validated as any
      
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

/**
 * 複数のターゲットを同時に検証するミドルウェア
 */
export function validateMultiple<
  TBody = unknown,
  TQuery = unknown,
  TParams = unknown
>(schemas: {
  body?: ZodSchema<TBody>
  query?: ZodSchema<TQuery>
  params?: ZodSchema<TParams>
}) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const errors: Array<{ field: string; message: string }> = []
      
      if (schemas.body) {
        try {
          req.body = await schemas.body.parseAsync(req.body)
        } catch (error) {
          if (error instanceof ZodError) {
            errors.push(...error.errors.map((err) => ({
              field: `body.${err.path.join('.')}`,
              message: err.message,
            })))
          }
        }
      }
      
      if (schemas.query) {
        try {
          req.query = await schemas.query.parseAsync(req.query) as any
        } catch (error) {
          if (error instanceof ZodError) {
            errors.push(...error.errors.map((err) => ({
              field: `query.${err.path.join('.')}`,
              message: err.message,
            })))
          }
        }
      }
      
      if (schemas.params) {
        try {
          req.params = await schemas.params.parseAsync(req.params) as any
        } catch (error) {
          if (error instanceof ZodError) {
            errors.push(...error.errors.map((err) => ({
              field: `params.${err.path.join('.')}`,
              message: err.message,
            })))
          }
        }
      }
      
      if (errors.length > 0) {
        throw new ApiError(400, 'バリデーションエラー', errors)
      }
      
      next()
    } catch (error) {
      next(error)
    }
  }
}
