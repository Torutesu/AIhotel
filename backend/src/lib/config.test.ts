import { afterEach, describe, expect, it, vi } from 'vitest'

// config.ts は import した時点で環境変数を読んで検証するため、
// 環境変数を差し替えるたびにモジュールを読み込み直す
async function loadConfigWith(env: Record<string, string | undefined>) {
  vi.resetModules()
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value as string)
  return (await import('./config.js')).config
}

const BASE = {
  JWT_SECRET: 'test-only-jwt-secret-value-0000000000000000',
  DATABASE_URL: 'postgresql://localhost:5432/test',
  // テスト全体の既定（memory）は本番で拒否されるため、各テストの検証対象だけが効くようにする
  MAIL_DRIVER: 'none',
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('FRONTEND_URL（R-2-2）', () => {
  it('本番で未設定なら起動を止める（黙って localhost にしない）', async () => {
    await expect(
      loadConfigWith({ ...BASE, NODE_ENV: 'production', FRONTEND_URL: undefined })
    ).rejects.toThrow('FRONTEND_URL')
  })

  it('本番で設定すれば、その URL を CORS とメール内のリンクに使う', async () => {
    const config = await loadConfigWith({
      ...BASE,
      NODE_ENV: 'production',
      FRONTEND_URL: 'https://app.example.com, https://preview.example.com',
    })
    expect(config.FRONTEND_URL).toEqual(['https://app.example.com', 'https://preview.example.com'])
    expect(config.appPublicUrl).toBe('https://app.example.com')
  })

  it('開発では未設定なら http://localhost:3000 にする', async () => {
    const config = await loadConfigWith({ ...BASE, NODE_ENV: 'development', FRONTEND_URL: undefined })
    expect(config.FRONTEND_URL).toEqual(['http://localhost:3000'])
    expect(config.appPublicUrl).toBe('http://localhost:3000')
  })

  it('空の値は開発でも受け付けない', async () => {
    await expect(loadConfigWith({ ...BASE, NODE_ENV: 'development', FRONTEND_URL: ' , ' })).rejects.toThrow(
      'FRONTEND_URL'
    )
  })
})

describe('PROXY_SHARED_SECRET（R-2-3）', () => {
  it('未設定でも起動できる（受け付けをネットワークで絞る構成のため任意）', async () => {
    const config = await loadConfigWith({ ...BASE, NODE_ENV: 'development', PROXY_SHARED_SECRET: undefined })
    expect(config.PROXY_SHARED_SECRET).toBeUndefined()
  })

  it('短すぎる値は受け付けない', async () => {
    await expect(
      loadConfigWith({ ...BASE, NODE_ENV: 'development', PROXY_SHARED_SECRET: 'short' })
    ).rejects.toThrow('PROXY_SHARED_SECRET')
  })
})
