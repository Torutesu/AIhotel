import { describe, it, expect } from 'vitest'
import {
  hashPassword,
  verifyPassword,
  generateAccessToken,
  verifyAccessToken,
  hashToken,
  getRefreshTokenExpiry,
  generateRefreshToken,
} from './auth.js'

const sampleUser = {
  id: 'user_123',
  email: 'test@example.com',
  role: 'ADMIN' as const,
  tenantId: 'tenant_123',
  hotelId: 'hotel_123',
}

describe('hashPassword / verifyPassword', () => {
  it('ハッシュ化したパスワードは平文と異なる', async () => {
    const hashed = await hashPassword('SuperSecret1')
    expect(hashed).not.toBe('SuperSecret1')
  })

  it('正しいパスワードは検証に成功する', async () => {
    const hashed = await hashPassword('SuperSecret1')
    await expect(verifyPassword('SuperSecret1', hashed)).resolves.toBe(true)
  })

  it('誤ったパスワードは検証に失敗する', async () => {
    const hashed = await hashPassword('SuperSecret1')
    await expect(verifyPassword('WrongPassword', hashed)).resolves.toBe(false)
  })
})

describe('generateAccessToken / verifyAccessToken', () => {
  it('生成したトークンを検証するとペイロードが往復する', () => {
    const token = generateAccessToken(sampleUser)
    const decoded = verifyAccessToken(token)

    expect(decoded.userId).toBe(sampleUser.id)
    expect(decoded.email).toBe(sampleUser.email)
    expect(decoded.role).toBe(sampleUser.role)
    expect(decoded.tenantId).toBe(sampleUser.tenantId)
    expect(decoded.hotelId).toBe(sampleUser.hotelId)
  })

  it('改ざんされたトークンは検証に失敗する', () => {
    const token = generateAccessToken(sampleUser)
    const tampered = `${token}tampered`

    expect(() => verifyAccessToken(tampered)).toThrow()
  })
})

describe('hashToken', () => {
  it('同じ入力に対して決定的に同じハッシュを返す', () => {
    const token = 'some-refresh-token-value'
    expect(hashToken(token)).toBe(hashToken(token))
  })

  it('異なる入力に対しては異なるハッシュを返す', () => {
    expect(hashToken('token-a')).not.toBe(hashToken('token-b'))
  })

  it('SHA-256の16進文字列（64文字）を返す', () => {
    const hashed = hashToken('token-a')
    expect(hashed).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('getRefreshTokenExpiry (JWT_REFRESH_EXPIRES_IN の間接検証)', () => {
  it('テスト環境の設定 (7d) に基づき、およそ7日後の日時を返す', () => {
    const before = Date.now()
    const expiry = getRefreshTokenExpiry()
    const after = Date.now()

    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000
    expect(expiry.getTime()).toBeGreaterThanOrEqual(before + sevenDaysMs - 1000)
    expect(expiry.getTime()).toBeLessThanOrEqual(after + sevenDaysMs + 1000)
  })
})

describe('generateRefreshToken', () => {
  it('同一ユーザーの連続発行でも必ず異なるトークンになる', () => {
    // iat は秒単位のため、jti がないと同じ秒内の2回目が完全一致し、
    // tokenHash の一意制約に衝突してログインが失敗する
    const a = generateRefreshToken('user-1')
    const b = generateRefreshToken('user-1')
    expect(a).not.toBe(b)
    expect(hashToken(a)).not.toBe(hashToken(b))
  })
})
