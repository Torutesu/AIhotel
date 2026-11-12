import type { FetchTarget } from '../../types.js'

// Booking.com・Agoda の料金ページの URL（D-13）。料金は JavaScript で描かれるので、ブラウザ（Playwright）で描画してから
// AI で読む（llmExtract.ts）。どちらも robots.txt でホテルのページは禁止されていない（2026-11-12 確認）が、
// 実際のページでの読み取りは、ブラウザの入ったイメージがまだ無いため確かめていない（既定では動かさない — CRAWL_ENABLED_SOURCES）。
// Expedia・Trip.com は robots.txt が料金のページ・料金の API を禁止、一休は robots.txt から 403 で拒否しているため、取得元を作らない。

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

/** 登録した URL の、クエリを除いた部分（https://www.booking.com/hotel/jp/xxx.ja.html） */
function basePath(url: string, host: RegExp, label: string): string {
  const u = new URL(url)
  if (!host.test(u.hostname)) throw new Error(`${label} の URL ではありません: ${url}`)
  return `${u.origin}${u.pathname}`
}

export function bookingUrl(target: FetchTarget, stayDate: string, occupancy: number): string {
  const q = new URLSearchParams({
    checkin: stayDate,
    checkout: addDays(stayDate, 1),
    group_adults: String(occupancy),
    group_children: '0',
    no_rooms: '1',
    selected_currency: 'JPY',
    lang: 'ja',
  })
  return `${basePath(target.url, /(^|\.)booking\.com$/, 'Booking.com')}?${q.toString()}`
}

export function agodaUrl(target: FetchTarget, stayDate: string, occupancy: number): string {
  const q = new URLSearchParams({
    checkIn: stayDate,
    los: '1',
    adults: String(occupancy),
    children: '0',
    rooms: '1',
    currencyCode: 'JPY',
  })
  return `${basePath(target.url, /(^|\.)agoda\.com$/, 'Agoda')}?${q.toString()}`
}
