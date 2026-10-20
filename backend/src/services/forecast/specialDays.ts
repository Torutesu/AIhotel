// 特日（祝日・お盆・年末年始・GW）の判定（2026-10 日のタイプの区分）。
// 画面の曜日欄の色（frontend/components/pricing/pricing-constants.ts の FIXED_HOLIDAYS / specialDayNameOf）と同じ一覧を使う。
// 移動する祝日（成人の日・海の日など）はマスタ設定で特日を直せるようになるまで扱わない。日付は UTC の 0時で受け取る。

const FIXED_HOLIDAYS: Record<string, string> = {
  '1-1': '元日',
  '2-11': '建国記念の日',
  '2-23': '天皇誕生日',
  '4-29': '昭和の日',
  '5-3': '憲法記念日',
  '5-4': 'みどりの日',
  '5-5': 'こどもの日',
  '8-11': '山の日',
  '11-3': '文化の日',
  '11-23': '勤労感謝の日',
}

/** 祝日・特日の名前。どちらでもなければ null */
export function specialDayName(date: Date): string | null {
  const m = date.getUTCMonth() + 1
  const d = date.getUTCDate()
  const holiday = FIXED_HOLIDAYS[`${m}-${d}`]
  if (holiday) return holiday
  if (m === 8 && d >= 13 && d <= 16) return 'お盆'
  if ((m === 12 && d >= 29) || (m === 1 && d <= 3)) return '年末年始'
  if ((m === 4 && d >= 29) || (m === 5 && d <= 5)) return 'GW'
  return null
}
