import { BlockList, isIP } from 'node:net'

// IP 制限（#12）の許可リストの解釈と照合。
//
// 許可リストは { cidr, label } の配列。cidr は単一アドレス（203.0.113.10）か範囲（203.0.113.0/24、2001:db8::/32）。
// 照合するクライアント IP は Express の req.ip（TRUST_PROXY の設定に従って X-Forwarded-For から取る）。
// IPv4 射影 IPv6（::ffff:203.0.113.10）は IPv4 として扱う。

export interface IpAllowEntry {
  cidr: string
  label: string | null
}

/** 許可リストの上限（テナントごと） */
export const MAX_IP_ALLOW_ENTRIES = 50

/** ::ffff:1.2.3.4 のような IPv4 射影アドレスを IPv4 に戻す。IP でなければ null */
export function normalizeIp(ip: string | undefined | null): string | null {
  if (!ip) return null
  const trimmed = ip.trim()
  const mapped = trimmed.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i)
  const value = mapped ? mapped[1] : trimmed
  return isIP(value) ? value : null
}

/** "203.0.113.0/24" や "203.0.113.10" を検証して正規化する。不正なら null */
export function parseCidr(input: string): { address: string; prefix: number; family: 'ipv4' | 'ipv6' } | null {
  const [rawAddress, rawPrefix, ...rest] = input.trim().split('/')
  if (rest.length > 0) return null
  const address = normalizeIp(rawAddress)
  if (!address) return null
  const family = isIP(address) === 4 ? 'ipv4' : 'ipv6'
  const max = family === 'ipv4' ? 32 : 128
  if (rawPrefix === undefined) return { address, prefix: max, family }
  if (!/^\d{1,3}$/.test(rawPrefix)) return null
  const prefix = Number(rawPrefix)
  if (prefix < 0 || prefix > max) return null
  return { address, prefix, family }
}

/** DB の値（Json）を許可リストとして読む。壊れた要素は捨てる */
export function readAllowlist(value: unknown): IpAllowEntry[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const cidr = (item as { cidr?: unknown })?.cidr
    const label = (item as { label?: unknown })?.label
    if (typeof cidr !== 'string' || !parseCidr(cidr)) return []
    return [{ cidr, label: typeof label === 'string' && label !== '' ? label : null }]
  })
}

/** クライアント IP が許可リストのどれかに入っているか。IP が分からなければ許可しない */
export function isIpAllowed(ip: string | undefined | null, entries: IpAllowEntry[]): boolean {
  const address = normalizeIp(ip)
  if (!address) return false
  const list = new BlockList()
  for (const entry of entries) {
    const parsed = parseCidr(entry.cidr)
    if (parsed) list.addSubnet(parsed.address, parsed.prefix, parsed.family)
  }
  return list.check(address, isIP(address) === 4 ? 'ipv4' : 'ipv6')
}

/** テナントの IP 制限でこのアクセスを止めるか（制限が無効なら常に通す） */
export function isBlockedByIpRestriction(
  tenant: { ipRestrictionEnabled: boolean; ipAllowlist: unknown } | null | undefined,
  ip: string | undefined | null
): boolean {
  if (!tenant?.ipRestrictionEnabled) return false
  return !isIpAllowed(ip, readAllowlist(tenant.ipAllowlist))
}

export const IP_NOT_ALLOWED_MESSAGE =
  '許可されていないネットワークからのアクセスです。社内ネットワークから接続するか、管理者にお問い合わせください'
