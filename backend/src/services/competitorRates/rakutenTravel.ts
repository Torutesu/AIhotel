import { logger } from '../../utils/logger.js'
import type { CompetitorRateSource, FetchedRate, FetchTarget } from './types.js'

// 楽天トラベルの取得元（#9 段階C）。画面の巡回ではなく、楽天ウェブサービスの公式 API（空室検索）を使う。
//
// - 競合の楽天 URL（https://travel.rakuten.co.jp/HOTEL/<施設番号>/...）から施設番号を取り出す
// - 1リクエストで最大15施設をまとめて問い合わせる（宿泊日×人数ごとに1回）。間隔は 1 秒以上（API の利用条件）
// - 取得条件の統一基準（types.ts）に合わせ、朝食・夕食の付かないプラン（素泊まり）の1室あたり税込料金の最安値を取る
// - 空室が無い（API が not_found を返す、または結果に施設が無い）人数がすべてなら満室とみなす
//
// 注意: レスポンスの形は公開仕様（formatVersion 1 / 2）に合わせて両方読めるようにしているが、
// 実際のアプリ ID での確認はまだ（キーの発行待ち）。発行後に1施設で突き合わせてから本番の定期取得に使う。

/** 1リクエストで問い合わせる施設の上限（API の仕様） */
export const RAKUTEN_MAX_HOTELS_PER_REQUEST = 15
const OCCUPANCIES = [1, 2, 3] as const

export function parseRakutenHotelNo(url: string): string | null {
  const m = url.match(/travel\.rakuten\.co\.jp\/HOTEL\/(\d+)/i)
  return m ? m[1] : null
}

type Json = Record<string, unknown>

interface PlanCharge {
  hotelNo: string
  /** 1室あたりの税込料金 */
  price: number | null
  roomOnly: boolean
}

const asNumber = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/**
 * 空室検索のレスポンスから、施設ごとのプランの料金を取り出す（純関数）。
 * formatVersion 1（hotels[].hotel[]）と 2（hotels[][]）のどちらも読む
 */
export function parseVacantHotelResponse(body: unknown, adultNum: number): PlanCharge[] {
  const hotels = (body as Json | null)?.hotels
  if (!Array.isArray(hotels)) return []
  const plans: PlanCharge[] = []
  for (const entry of hotels) {
    const parts: unknown[] = Array.isArray(entry) ? entry : Array.isArray((entry as Json)?.hotel) ? ((entry as Json).hotel as unknown[]) : []
    const basic = parts.find((p) => (p as Json)?.hotelBasicInfo) as Json | undefined
    const hotelNo = asNumber((basic?.hotelBasicInfo as Json | undefined)?.hotelNo)
    if (hotelNo == null) continue
    for (const part of parts) {
      const roomInfo = (part as Json)?.roomInfo
      if (!Array.isArray(roomInfo)) continue
      const merged: Json = Object.assign({}, ...roomInfo.map((r) => (typeof r === 'object' && r ? r : {})))
      const room = (merged.roomBasicInfo ?? {}) as Json
      const charge = (merged.dailyCharge ?? {}) as Json
      const total = asNumber(charge.total)
      const unit = asNumber(charge.rakutenCharge)
      // total は1室の合計。無ければ料金区分（0: 1人あたり / 1: 1室あたり）から組み立てる
      const price = total ?? (unit == null ? null : asNumber(charge.chargeFlag) === 0 ? unit * adultNum : unit)
      const roomOnly = asNumber(room.withBreakfastFlag) === 0 && asNumber(room.withDinnerFlag) === 0
      plans.push({ hotelNo: String(hotelNo), price, roomOnly })
    }
  }
  return plans
}

export interface RakutenTravelOptions {
  applicationId: string
  /**
   * 予備のアプリ ID。メインの ID が無効（失効・削除・停止）と返されたときだけ、順に切り替える。
   * 上限超過（429）では切り替えない — 複数の ID でアクセス量を増やすと楽天ウェブサービスの上限逃れになるため
   */
  backupApplicationIds?: string[]
  endpoint: string
  intervalMs: number
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

/** アプリ ID が無効・停止と返されたか（楽天ウェブサービスは 400 wrong_parameter か 401/403 で返す） */
export function isInvalidApplicationId(status: number, body: unknown): boolean {
  if (status === 401 || status === 403) return true
  const description = String((body as Json | null)?.error_description ?? '')
  return status === 400 && /applicationId/i.test(description)
}

const addDay = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

export function createRakutenTravelSource(options: RakutenTravelOptions): CompetitorRateSource {
  const fetchImpl = options.fetchImpl ?? fetch
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  let lastRequestAt = 0
  const applicationIds = [options.applicationId, ...(options.backupApplicationIds ?? [])]
  let current = 0

  async function search(hotelNos: string[], stayDate: string, adultNum: number): Promise<PlanCharge[]> {
    const wait = lastRequestAt + options.intervalMs - Date.now()
    if (wait > 0) await sleep(wait)
    lastRequestAt = Date.now()

    const params = new URLSearchParams({
      applicationId: applicationIds[current],
      format: 'json',
      formatVersion: '2',
      hotelNo: hotelNos.join(','),
      checkinDate: stayDate,
      checkoutDate: addDay(stayDate),
      adultNum: String(adultNum),
      roomNum: '1',
    })
    const res = await fetchImpl(`${options.endpoint}?${params.toString()}`)
    const body: unknown = await res.json().catch(() => null)
    // 空室が1件も無いときは 404 not_found が返る（満室の扱い）
    if (res.status === 404 && (body as Json | null)?.error === 'not_found') return []
    if (isInvalidApplicationId(res.status, body) && current < applicationIds.length - 1) {
      // メインの ID が使えなくなった。予備に切り替えて同じ条件で問い合わせ直す（ID そのものはログに出さない）
      current += 1
      logger.warn({ backupIndex: current }, '楽天トラベル API のアプリ ID が無効と返されたため、予備の ID に切り替えます')
      return search(hotelNos, stayDate, adultNum)
    }
    if (!res.ok) {
      const error = (body as Json | null)?.error_description ?? (body as Json | null)?.error ?? res.statusText
      throw new Error(`楽天トラベル API がエラーを返しました（${res.status}: ${String(error)}）`)
    }
    return parseVacantHotelResponse(body, adultNum)
  }

  async function fetchBatch(targets: FetchTarget[], stayDates: string[]): Promise<Map<string, FetchedRate[]>> {
    const byHotelNo = new Map<string, string[]>()
    for (const t of targets) {
      const hotelNo = parseRakutenHotelNo(t.url)
      if (!hotelNo) throw new Error(`楽天トラベルの URL から施設番号を読み取れません（${t.competitorName}: ${t.url}）`)
      byHotelNo.set(hotelNo, [...(byHotelNo.get(hotelNo) ?? []), t.competitorId])
    }
    const hotelNos = [...byHotelNo.keys()]
    const chunks: string[][] = []
    for (let i = 0; i < hotelNos.length; i += RAKUTEN_MAX_HOTELS_PER_REQUEST) {
      chunks.push(hotelNos.slice(i, i + RAKUTEN_MAX_HOTELS_PER_REQUEST))
    }

    const result = new Map<string, FetchedRate[]>(targets.map((t) => [t.competitorId, []]))
    for (const stayDate of stayDates) {
      // hotelNo → 人数 → 素泊まりの最安値（null は空室はあるが素泊まりが無い） / 空室の有無
      const prices = new Map<string, Array<number | null>>()
      const vacant = new Map<string, boolean>()
      for (const [index, adultNum] of OCCUPANCIES.entries()) {
        for (const chunk of chunks) {
          const plans = await search(chunk, stayDate, adultNum)
          for (const hotelNo of chunk) {
            const own = plans.filter((p) => p.hotelNo === hotelNo)
            if (own.length > 0) vacant.set(hotelNo, true)
            const roomOnly = own.filter((p) => p.roomOnly && p.price != null).map((p) => p.price as number)
            const row = prices.get(hotelNo) ?? [null, null, null]
            row[index] = roomOnly.length > 0 ? Math.min(...roomOnly) : null
            prices.set(hotelNo, row)
          }
        }
      }
      for (const [hotelNo, competitorIds] of byHotelNo) {
        const [price1P, price2P, price3P] = prices.get(hotelNo) ?? [null, null, null]
        const soldOut = !vacant.get(hotelNo)
        for (const competitorId of competitorIds) {
          result.get(competitorId)!.push({ stayDate, price1P, price2P, price3P, soldOut })
        }
      }
    }
    return result
  }

  return {
    key: 'rakuten',
    fetchBatch,
    async fetch(target, stayDates) {
      return (await fetchBatch([target], stayDates)).get(target.competitorId) ?? []
    },
  }
}
