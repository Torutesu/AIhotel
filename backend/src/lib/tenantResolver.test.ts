import { describe, it, expect } from 'vitest'
import { extractTenantCodeFromHost, isAllowedOrigin } from './tenantResolver.js'

const BASE = 'app.example.com'

describe('extractTenantCodeFromHost', () => {
  it('サブドメインをテナントコードとして返す', () => {
    expect(extractTenantCodeFromHost('alpha.app.example.com', BASE)).toBe('alpha')
  })

  it('ポート番号と大文字を正規化する', () => {
    expect(extractTenantCodeFromHost('Alpha.App.Example.com:443', BASE)).toBe('alpha')
  })

  it('ベースドメインそのものはテナント指定なし', () => {
    expect(extractTenantCodeFromHost(BASE, BASE)).toBeNull()
  })

  it('予約サブドメインはテナントとして扱わない', () => {
    for (const sub of ['www', 'api', 'app', 'admin']) {
      expect(extractTenantCodeFromHost(`${sub}.${BASE}`, BASE)).toBeNull()
    }
  })

  it('多段サブドメインは受け付けない', () => {
    expect(extractTenantCodeFromHost('a.b.app.example.com', BASE)).toBeNull()
  })

  it('別ドメインからのアクセスは null（詐称対策）', () => {
    expect(extractTenantCodeFromHost('alpha.app.example.com.evil.jp', BASE)).toBeNull()
    expect(extractTenantCodeFromHost('evilapp.example.com', BASE)).toBeNull()
  })

  it('テナントコードの形式に合わないものは弾く', () => {
    expect(extractTenantCodeFromHost('-bad.app.example.com', BASE)).toBeNull()
    expect(extractTenantCodeFromHost('BAD_CODE.app.example.com', BASE)).toBeNull()
  })

  it('ベースドメイン未設定（ローカル開発）では常に null', () => {
    expect(extractTenantCodeFromHost('alpha.localhost:3000', undefined)).toBeNull()
  })
})

describe('isAllowedOrigin', () => {
  it('明示的に指定されたオリジンは許可する', () => {
    expect(isAllowedOrigin('http://localhost:3000', undefined, ['http://localhost:3000'])).toBe(true)
  })

  it('ベースドメインとそのサブドメインを許可する', () => {
    expect(isAllowedOrigin(`https://${BASE}`, BASE, [])).toBe(true)
    expect(isAllowedOrigin(`https://alpha.${BASE}`, BASE, [])).toBe(true)
  })

  it('サブドメインを装った別ドメインは拒否する', () => {
    expect(isAllowedOrigin('https://alpha.app.example.com.evil.jp', BASE, [])).toBe(false)
    expect(isAllowedOrigin('https://evilapp.example.com', BASE, [])).toBe(false)
  })

  it('テナント用オリジンは HTTPS のみ許可する', () => {
    expect(isAllowedOrigin(`http://alpha.${BASE}`, BASE, [])).toBe(false)
  })

  it('不正な文字列は拒否する', () => {
    expect(isAllowedOrigin('not-a-url', BASE, [])).toBe(false)
  })
})
