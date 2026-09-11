import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ApiError } from '../middlewares/errorHandler.js'

const prismaMock = {
  user: { findUnique: vi.fn(), create: vi.fn() },
  hotel: { findUnique: vi.fn() },
}

vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('./auditService.js', () => ({ writeAuditLog: vi.fn() }))

const { registerService } = await import('./authService.js')

const input = {
  email: 'new@example.com',
  password: 'Password123',
  name: '新規ユーザー',
  hotelId: 'hotel-of-other-tenant',
}

describe('registerService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.user.findUnique.mockResolvedValue(null)
    prismaMock.user.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'u1', ...data })
    )
  })

  it('他テナントのホテルIDを指定したユーザー作成を拒否する', async () => {
    prismaMock.hotel.findUnique.mockResolvedValue({ id: input.hotelId, tenantId: 'tenant-b' })

    const error = await registerService(input, { userId: 'admin1', tenantId: 'tenant-a' }).catch(
      (e: ApiError) => e
    )

    expect((error as ApiError).statusCode).toBe(400)
    expect(prismaMock.user.create).not.toHaveBeenCalled()
  })

  it('作成されるユーザーの tenantId は作成者のテナントになる', async () => {
    prismaMock.hotel.findUnique.mockResolvedValue({ id: input.hotelId, tenantId: 'tenant-a' })

    const user = await registerService(input, { userId: 'admin1', tenantId: 'tenant-a' })

    expect(user.tenantId).toBe('tenant-a')
  })

  it('テナント未所属ユーザーによる登録を拒否する', async () => {
    const error = await registerService(input, { userId: 'admin1', tenantId: null }).catch(
      (e: ApiError) => e
    )

    expect((error as ApiError).statusCode).toBe(403)
    expect(prismaMock.user.create).not.toHaveBeenCalled()
  })
})
