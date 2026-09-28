import { describe, it, expect } from 'vitest'
import { isBlockedByIpRestriction, isIpAllowed, normalizeIp, parseCidr, readAllowlist } from './ipAllowlist.js'

// IP 制限（#12）の許可リストの解釈と照合

describe('parseCidr', () => {
  it('単一アドレス・IPv4 / IPv6 の範囲を読み、不正な値は null', () => {
    expect(parseCidr('203.0.113.10')).toEqual({ address: '203.0.113.10', prefix: 32, family: 'ipv4' })
    expect(parseCidr(' 203.0.113.0/24 ')).toEqual({ address: '203.0.113.0', prefix: 24, family: 'ipv4' })
    expect(parseCidr('2001:db8::/32')).toEqual({ address: '2001:db8::', prefix: 32, family: 'ipv6' })
    expect(parseCidr('203.0.113.0/33')).toBeNull()
    expect(parseCidr('203.0.113/24')).toBeNull()
    expect(parseCidr('example.com')).toBeNull()
    expect(parseCidr('1.2.3.4/24/1')).toBeNull()
  })
})

describe('isIpAllowed', () => {
  const entries = [
    { cidr: '203.0.113.0/24', label: '本社' },
    { cidr: '198.51.100.7', label: null },
    { cidr: '2001:db8::/32', label: null },
  ]

  it('範囲・単一アドレス・IPv6 と、IPv4 射影 IPv6 を照合する', () => {
    expect(isIpAllowed('203.0.113.200', entries)).toBe(true)
    expect(isIpAllowed('::ffff:203.0.113.5', entries)).toBe(true)
    expect(isIpAllowed('198.51.100.7', entries)).toBe(true)
    expect(isIpAllowed('198.51.100.8', entries)).toBe(false)
    expect(isIpAllowed('2001:db8:1::1', entries)).toBe(true)
  })

  it('IP が分からなければ許可しない', () => {
    expect(isIpAllowed(undefined, entries)).toBe(false)
    expect(isIpAllowed('unknown', entries)).toBe(false)
  })
})

describe('isBlockedByIpRestriction', () => {
  it('制限が無効なら常に通し、有効ならリスト外を止める', () => {
    const allowlist = [{ cidr: '203.0.113.0/24', label: null }]
    expect(isBlockedByIpRestriction({ ipRestrictionEnabled: false, ipAllowlist: allowlist }, '192.0.2.1')).toBe(false)
    expect(isBlockedByIpRestriction({ ipRestrictionEnabled: true, ipAllowlist: allowlist }, '192.0.2.1')).toBe(true)
    expect(isBlockedByIpRestriction({ ipRestrictionEnabled: true, ipAllowlist: allowlist }, '203.0.113.9')).toBe(false)
    // 運営（テナントなし）は対象外
    expect(isBlockedByIpRestriction(null, '192.0.2.1')).toBe(false)
  })
})

describe('readAllowlist / normalizeIp', () => {
  it('壊れた要素は捨てる', () => {
    expect(readAllowlist([{ cidr: '203.0.113.0/24', label: '' }, { cidr: 'bad' }, 'x', null])).toEqual([
      { cidr: '203.0.113.0/24', label: null },
    ])
    expect(readAllowlist('not-array')).toEqual([])
  })

  it('IPv4 射影 IPv6 を IPv4 に戻す', () => {
    expect(normalizeIp('::ffff:127.0.0.1')).toBe('127.0.0.1')
    expect(normalizeIp('::1')).toBe('::1')
    expect(normalizeIp('')).toBeNull()
  })
})
