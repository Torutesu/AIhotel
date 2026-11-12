import { holidayName } from '../../lib/jpHolidays.js'
import { travelSeasonsOf } from '../../lib/travelSeasons.js'

// 特日（祝日・祝前日・お盆・年末年始・GW）の判定（2026-10 日のタイプの区分。D-13 で内閣府の祝日に置き換え、
// 年末年始・GW・お盆の範囲を先方の資料「外部要因と旅行（宿泊）の関連付け」の時間軸に合わせた）。
// 画面の曜日欄の色（frontend/components/pricing/pricing-constants.ts の holidayNameOf / specialDayNameOf）と同じ判定にする。
// 祝日は lib/jpHolidays.ts（移動祝日・振替休日・国民の休日を含む）。日付は UTC の 0時で受け取る。

const DAY_MS = 86_400_000

/** 祝日・特日の名前。どちらでもなければ null */
export function specialDayName(date: Date): string | null {
  const holiday = holidayName(date)
  if (holiday) return holiday
  const seasons = travelSeasonsOf(date)
  if (seasons.includes('obon')) return 'お盆'
  if (seasons.includes('yearEnd')) return '年末年始'
  if (seasons.includes('goldenWeek')) return 'GW'
  // 祝日の前の泊（休前日）。宿泊は「翌日が休み」の泊に需要が集まるため、ふだんの日の型に混ぜない
  if (holidayName(new Date(date.getTime() + DAY_MS)) != null) return '祝前日'
  return null
}
