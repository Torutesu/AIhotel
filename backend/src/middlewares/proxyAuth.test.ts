import { describe, expect, it, vi } from 'vitest'
import type { NextFunction, Request, Response } from 'express'
import { PROXY_AUTH_HEADER, requireProxySecret } from './proxyAuth.js'
import { ApiError } from './errorHandler.js'

const SECRET = 'proxy-shared-secret-for-tests-0000000000'
const EXEMPT = new Set(['/api/health'])

function run(middleware: ReturnType<typeof requireProxySecret>, url: string, headerValue?: string) {
  const req = {
    originalUrl: url,
    headers: headerValue === undefined ? {} : { [PROXY_AUTH_HEADER]: headerValue },
  } as unknown as Request
  const next = vi.fn() as unknown as NextFunction & ReturnType<typeof vi.fn>
  middleware(req, {} as Response, next)
  return next
}

describe('requireProxySecret（R-2-3）', () => {
  it('秘密の値が一致すれば通す', () => {
    const next = run(requireProxySecret(SECRET, EXEMPT), '/api/v1/hotels', SECRET)
    expect(next).toHaveBeenCalledWith()
  })

  it('ヘッダーが無い・違う値・長さが違う値は 403', () => {
    const middleware = requireProxySecret(SECRET, EXEMPT)
    for (const value of [undefined, SECRET.replace(/0$/, '1'), 'short']) {
      const next = run(middleware, '/api/v1/auth/login', value)
      const error = next.mock.calls[0][0]
      expect(error, String(value)).toBeInstanceOf(ApiError)
      expect((error as ApiError).statusCode).toBe(403)
    }
  })

  it('ヘルスチェックは秘密の値が無くても通す（監視が直接叩く）', () => {
    const next = run(requireProxySecret(SECRET, EXEMPT), '/api/health?probe=1')
    expect(next).toHaveBeenCalledWith()
  })

  it('秘密の値が未設定なら何もしない', () => {
    const next = run(requireProxySecret(undefined, EXEMPT), '/api/v1/hotels')
    expect(next).toHaveBeenCalledWith()
  })
})
