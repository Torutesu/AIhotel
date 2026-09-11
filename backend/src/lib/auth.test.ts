import { describe, it, expect } from 'vitest'
import jwt from 'jsonwebtoken'
import {
  hashPassword,
  verifyPassword,
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  hashToken,
  getRefreshTokenExpiry,
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

  it('アクセストークンには type=access クレームが含まれる（S-1）', () => {
    const token = generateAccessToken(sampleUser)
    const decoded = jwt.decode(token) as { type?: string }
    expect(decoded.type).toBe('access')
  })

  it('検証結果に type クレームは含めない（req.user はユーザー情報のみ）', () => {
    const decoded = verifyAccessToken(generateAccessToken(sampleUser))
    expect(decoded).not.toHaveProperty('type')
  })

  it('リフレッシュトークンをアクセストークンとして検証すると失敗する（S-1）', () => {
    const refreshToken = generateRefreshToken(sampleUser.id)
    expect(() => verifyAccessToken(refreshToken)).toThrow('無効なトークンです')
  })

  it('type クレームの無い（旧形式の）トークンは署名が正しくても拒否する（S-1）', () => {
    const legacy = jwt.sign(
      { userId: sampleUser.id, email: sampleUser.email, role: sampleUser.role },
      'test-jwt-secret-please-ignore-0123456789abcdef'
    )
    expect(() => verifyAccessToken(legacy)).toThrow('無効なトークンです')
  })
})

describe('generateRefreshToken / verifyRefreshToken', () => {
  it('生成したリフレッシュトークンを検証すると userId が往復する', () => {
    const token = generateRefreshToken(sampleUser.id)
    expect(verifyRefreshToken(token)).toEqual({ userId: sampleUser.id })
  })

  it('アクセストークンをリフレッシュトークンとして検証すると失敗する（S-1）', () => {
    const accessToken = generateAccessToken(sampleUser)
    expect(() => verifyRefreshToken(accessToken)).toThrow('無効なリフレッシュトークンです')
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
