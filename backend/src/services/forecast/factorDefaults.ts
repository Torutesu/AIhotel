// 要因係数の初期値（docs/外部要因設計.md §5.2 L0）。
// ホテル別の学習値（FactorCoefficient）が無いキーはここの値を使う。
// 単位: 需要側キーは「稼働率への加算 pt」（0.10 = +10pt）。それ以外はキーごとに記載。

export const FACTOR_DEFAULTS: Record<string, number> = {
  // ---- イベント（Event.expectedImpact）
  'event:high': 0.15,
  'event:medium': 0.08,
  'event:low': 0.03,

  // ---- 祝日・連休（holidaySignal.ts）。土日のみの週末は base が吸収するため対象外
  'holiday:eve': 0.10, // 祝日を含む連休の前夜（当日は平日）
  'holiday:within': 0.08, // 2連休の中（翌日も休み）
  'holiday:within_long': 0.12, // 3連休以上の中日
  'holiday:last': -0.10, // 連休最終夜（翌日は平日）
  'holiday:bridge': 0.04, // 飛び石の平日

  // ---- ホテル定義の週末（Hotel.weekendDays）。同曜日平均が既に吸収しているため控えめ（rule-based-v1 と同値）
  'weekend:hotel': 0.05,

  // ---- 特別期間・学校休暇
  'special:gw': 0.10,
  'special:obon': 0.10,
  'special:nenmatsu': 0.08,
  'school:spring': 0.02,
  'school:summer': 0.03,
  'school:winter': 0.02,

  // ---- 天候（雨/雪、または降水確率60%以上）。直前需要にのみ効く。都市ビジネスでは学習で0に近づく想定
  'weather:rain_lead0_3': -0.04,
  'weather:rain_lead4_7': -0.01,

  // ---- 予約ペースの信頼度 α（リードタイム区分別）。D = (1-α)·Base + α·PaceProjection
  'pace:alpha_lead0_3': 0.8,
  'pace:alpha_lead4_7': 0.6,
  'pace:alpha_lead8_30': 0.4,
  'pace:alpha_lead31_90': 0.2,
  'pace:alpha_lead91': 0.1,

  // ---- 価格反応モデル（priceResponse.ts）。sigma は支払意思額の対数正規ばらつき
  'price:sigma': 0.35,

  // ---- 戦略候補の許容幅（rankDecision.ts）。収益最大値からどこまで RevPAR を犠牲にして稼働/レートを優先するか
  'strategy:occ_revpar_tolerance': 0.05,
  'strategy:adr_revpar_tolerance': 0.02,

  // ---- 信頼度校正: リードタイム区分別の稼働率予測 MAPE（実績で上書きされる）
  'calib:lead0_3': 0.06,
  'calib:lead4_7': 0.09,
  'calib:lead8_30': 0.13,
  'calib:lead31_90': 0.17,
  'calib:lead91': 0.22,
}

export type LeadBucket = 'lead0_3' | 'lead4_7' | 'lead8_30' | 'lead31_90' | 'lead91'

export function leadBucket(leadDays: number): LeadBucket {
  if (leadDays <= 3) return 'lead0_3'
  if (leadDays <= 7) return 'lead4_7'
  if (leadDays <= 30) return 'lead8_30'
  if (leadDays <= 90) return 'lead31_90'
  return 'lead91'
}

/** 要因キーの日本語ラベル（UI 表示用。UI は日本語 — AGENTS.md） */
export const FACTOR_LABELS: Record<string, string> = {
  base: '基準（曜日・季節・前年）',
  pace: '予約ペース',
  'event:high': 'イベント（影響 大）',
  'event:medium': 'イベント（影響 中）',
  'event:low': 'イベント（影響 小）',
  'holiday:eve': '連休前夜',
  'holiday:within': '連休中',
  'holiday:within_long': '3連休以上の中日',
  'holiday:last': '連休最終夜',
  'holiday:bridge': '飛び石の平日',
  'special:gw': 'ゴールデンウィーク',
  'special:obon': 'お盆',
  'special:nenmatsu': '年末年始',
  'school:spring': '春休み',
  'school:summer': '夏休み',
  'school:winter': '冬休み',
  'weather:rain_lead0_3': '雨予報（直前）',
  'weather:rain_lead4_7': '雨予報（4〜7日先）',
  'weekend:hotel': '週末（ホテル定義）',
}

export function factorLabel(key: string): string {
  return FACTOR_LABELS[key] ?? key
}

export type CoefficientMap = ReadonlyMap<string, number>

export function coefficientsWithDefaults(overrides: Iterable<readonly [string, number]> = []): Map<string, number> {
  const map = new Map<string, number>(Object.entries(FACTOR_DEFAULTS))
  for (const [k, v] of overrides) map.set(k, v)
  return map
}

export function getCoefficient(map: CoefficientMap, key: string): number {
  return map.get(key) ?? FACTOR_DEFAULTS[key] ?? 0
}
