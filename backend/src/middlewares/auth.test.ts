import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Request, Response, NextFunction } from 'express'
import { ApiError } from './errorHandler.js'

const isHotelInTenantService = vi.fn()

vi.mock('../services/hotelsService.js', () => ({
  isHotelInTenantService: (hotelId: string, tenantId: string) =>
    isHotelInTenantService(hotelId, tenantId),
}))

const { requireHotelAccess } = await import('./auth.js')

function run(
  user: { role: string; tenantId: string | null; hotelId: string | null } | undefined,
  hotelId: string | undefined
) {
  const req = { user, query: { hotelId } } as unknown as Request
  const next = vi.fn() as unknown as NextFunction
  const middleware = requireHotelAccess((r) => r.query.hotelId as string | undefined)
  return middleware(req, {} as Response, next).then(() => next as unknown as ReturnType<typeof vi.fn>)
}

describe('requireHotelAccess', () => {
  beforeEach(() => {
    isHotelInTenantService.mockReset()
    isHotelInTenantService.mockResolvedValue(true)
  })

  it('自テナントのホテルにアクセスする MANAGER は通過する', async () => {
    const next = await run({ role: 'MANAGER', tenantId: 't1', hotelId: 'h1' }, 'h1')
    expect(next).toHaveBeenCalledWith()
  })

  it('他ホテルを指定した MANAGER は403', async () => {
    const next = await run({ role: 'MANAGER', tenantId: 't1', hotelId: 'h1' }, 'h2')
    const err = next.mock.calls[0][0] as ApiError
    expect(err.statusCode).toBe(403)
  })

  it('ADMIN でも他テナントのホテルは403（テナント越えを防ぐ）', async () => {
    isHotelInTenantService.mockResolvedValue(false)
    const next = await run({ role: 'ADMIN', tenantId: 't1', hotelId: null }, 'other-tenant-hotel')
    const err = next.mock.calls[0][0] as ApiError
    expect(err.statusCode).toBe(403)
    expect(isHotelInTenantService).toHaveBeenCalledWith('other-tenant-hotel', 't1')
  })

  it('ADMIN は自テナントの他ホテルにアクセスできる', async () => {
    const next = await run({ role: 'ADMIN', tenantId: 't1', hotelId: null }, 'h9')
    expect(next).toHaveBeenCalledWith()
  })

  it('hotelId 未指定は ADMIN でも400（検証をスキップしない）', async () => {
    const next = await run({ role: 'ADMIN', tenantId: 't1', hotelId: null }, undefined)
    const err = next.mock.calls[0][0] as ApiError
    expect(err.statusCode).toBe(400)
  })

  it('テナント未所属ユーザーは403', async () => {
    const next = await run({ role: 'ADMIN', tenantId: null, hotelId: null }, 'h1')
    const err = next.mock.calls[0][0] as ApiError
    expect(err.statusCode).toBe(403)
  })
})
