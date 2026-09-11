import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Request, Response, NextFunction } from 'express'

const loggerMock = { error: vi.fn(), warn: vi.fn() }

vi.mock('../utils/logger.js', () => ({ logger: loggerMock }))

const { errorHandler } = await import('./errorHandler.js')

describe('errorHandler のログ出力', () => {
  beforeEach(() => vi.clearAllMocks())

  it('500 系ログに認証ヘッダ・リクエストボディを含めない', () => {
    const req = {
      method: 'POST',
      path: '/api/v1/auth/login',
      url: '/api/v1/auth/login',
      headers: { authorization: 'Bearer SECRET_TOKEN', cookie: 'session=abc' },
      body: { email: 'a@example.com', password: 'SUPER_SECRET' },
      user: { userId: 'u1' },
    } as unknown as Request
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response

    errorHandler(new Error('boom'), req, res, vi.fn() as unknown as NextFunction)

    expect(loggerMock.error).toHaveBeenCalledTimes(1)
    const logged = JSON.stringify(loggerMock.error.mock.calls[0][0])
    expect(logged).not.toContain('SECRET_TOKEN')
    expect(logged).not.toContain('SUPER_SECRET')
    expect(logged).not.toContain('session=abc')
    expect(logged).toContain('/api/v1/auth/login')
  })
})
