// 予約明細からブッキングカーブを作る（D-13 — 立ち上げで過去の予約の推移を入れる推奨の方法）。
// PMS・サイトコントローラーから「予約日・チェックイン日・泊数・室数・取消日」の明細を出してもらえれば、
// どの残日数の時点で何室入っていたか（OTB）を後から正確に作れる（その時点で予約済みで、まだ取り消されていない室数の合計）。
// 純関数にしてテストで固定する。

const DAY_MS = 86_400_000

/** 作る残日数（ピックアップ型のマイルストーンと典型カーブの残日数を含む） */
export const RESERVATION_CURVE_LEADS = [0, 1, 3, 5, 7, 14, 21, 30, 45, 60, 90, 120, 150, 180, 270, 330] as const

export interface ReservationRow {
  bookedDate: string
  checkInDate: string
  nights: number
  rooms: number
  cancelledDate?: string | null
}

const toTime = (iso: string) => Date.parse(`${iso}T00:00:00Z`)
const toIso = (t: number) => new Date(t).toISOString().slice(0, 10)

/**
 * 宿泊日（stayFrom〜stayTo）× 残日数ごとの予約室数。予約日がその時点より後の予約、その時点までに取り消された予約は数えない。
 * 残日数の時点が予約明細の一番古い予約日より前になる組は作らない（明細の範囲外で 0 と区別できないため）
 */
export function reservationsToCurve(
  rows: ReservationRow[],
  stayFrom: string,
  stayTo: string,
  leads: readonly number[] = RESERVATION_CURVE_LEADS
): Array<{ stayDate: string; daysBefore: number; roomsBooked: number }> {
  const from = toTime(stayFrom)
  const to = toTime(stayTo)
  const earliestBooking = Math.min(...rows.map((r) => toTime(r.bookedDate)))
  // 宿泊日ごとに、その泊にかかる予約（予約日・取消日・室数）
  const byStay = new Map<number, Array<{ booked: number; cancelled: number | null; rooms: number }>>()
  for (const r of rows) {
    const checkIn = toTime(r.checkInDate)
    for (let n = 0; n < r.nights; n++) {
      const stay = checkIn + n * DAY_MS
      if (stay < from || stay > to) continue
      const list = byStay.get(stay) ?? []
      list.push({ booked: toTime(r.bookedDate), cancelled: r.cancelledDate ? toTime(r.cancelledDate) : null, rooms: r.rooms })
      byStay.set(stay, list)
    }
  }
  const points: Array<{ stayDate: string; daysBefore: number; roomsBooked: number }> = []
  for (let stay = from; stay <= to; stay += DAY_MS) {
    const list = byStay.get(stay) ?? []
    for (const lead of leads) {
      const asOf = stay - lead * DAY_MS
      if (asOf < earliestBooking) continue
      // asOf の日の終わりの時点: その日までに予約され、その日までに取り消されていない
      const roomsBooked = list.reduce((sum, r) => sum + (r.booked <= asOf && (r.cancelled == null || r.cancelled > asOf) ? r.rooms : 0), 0)
      points.push({ stayDate: toIso(stay), daysBefore: lead, roomsBooked })
    }
  }
  return points
}
