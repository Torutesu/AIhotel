// ホテルのティア（説明の深さと運用の任せ方）。docs/外部要因設計.md §7、docs/販売代理店向け説明.md
//
// ティアは「ホテルの規模」ではなく「レベニューマネジメントの体制と理解度」で決める。ヒアリングで決め、
// 個社MDの「ティア:」か設定タブで設定する。アルゴリズムは同じで、変わるのは説明の深さ・自動採用の既定・
// 画面で前に出す情報だけ。
export type ExplanationTier = 'ENTERPRISE' | 'STANDARD' | 'MANAGED'

export interface TierProfile {
  id: ExplanationTier
  label: string
  /** 想定するホテル像（販売代理店向けの説明にも使う） */
  audience: string
  /** チャット・AIまとめの語り口と深さ（システムプロンプトに載せる） */
  explanationStyle: string
  /** AIまとめの最大項目数 */
  summaryLimits: { highlights: number; actions: number; caveats: number }
  /** ルール節で自動採用が明示されていないときの既定 */
  defaultAutoAdopt: boolean
  /** 画面で前に出す情報（UI のヒント） */
  uiEmphasis: 'full' | 'digest' | 'minimal'
}

export const TIER_PROFILES: Record<ExplanationTier, TierProfile> = {
  ENTERPRISE: {
    id: 'ENTERPRISE',
    label: 'エンタープライズ（詳細）',
    audience: '大手・チェーン・レベニューマネージャー専任。指標と理由を細かく見て自分で判断する',
    explanationStyle:
      '相手はレベニューマネジメントの専門家。用語（RevPAR・ペース・弾力性・信頼区間）はそのまま使い、需要要因のpt内訳、ランク寄与、候補の違い、信頼区間、要因評価の数字まで示す。判断は相手に委ね、選択肢と根拠を並べる。',
    summaryLimits: { highlights: 5, actions: 4, caveats: 3 },
    defaultAutoAdopt: false,
    uiEmphasis: 'full',
  },
  STANDARD: {
    id: 'STANDARD',
    label: 'スタンダード（標準）',
    audience: '中規模・支配人やフロント責任者が兼任。要点と理由が分かれば自分で採否を決められる',
    explanationStyle:
      '相手は兼任担当者。専門用語は最初に一言で言い換え（例: RevPAR＝1室あたり売上）、理由は主な要因2〜3個に絞る。数字は結論に必要なものだけ。推奨と、採用しないならどう変えるかを示す。',
    summaryLimits: { highlights: 4, actions: 3, caveats: 2 },
    defaultAutoAdopt: false,
    uiEmphasis: 'digest',
  },
  MANAGED: {
    id: 'MANAGED',
    label: 'おまかせ（運用代行）',
    audience: '旅館・小規模・専任なし。価格はシステム側で決め、ホテルは結果と例外だけ見る',
    explanationStyle:
      '相手は専門知識を前提にしない。結論（今日この日は何円にするか）と一言の理由だけを短く言う。用語は使わず、pt や信頼区間などの数字は出さない。確認が必要なこと（団体・工事・休館）だけを尋ねる。',
    summaryLimits: { highlights: 3, actions: 2, caveats: 1 },
    defaultAutoAdopt: true,
    uiEmphasis: 'minimal',
  },
}

export const TIER_ALIASES: Record<string, ExplanationTier> = {
  エンタープライズ: 'ENTERPRISE',
  大手: 'ENTERPRISE',
  詳細: 'ENTERPRISE',
  enterprise: 'ENTERPRISE',
  スタンダード: 'STANDARD',
  標準: 'STANDARD',
  普通: 'STANDARD',
  standard: 'STANDARD',
  おまかせ: 'MANAGED',
  運用代行: 'MANAGED',
  旅館: 'MANAGED',
  小規模: 'MANAGED',
  簡易: 'MANAGED',
  managed: 'MANAGED',
}

export function parseTier(value: string): ExplanationTier | null {
  const v = value.trim()
  if (v in TIER_PROFILES) return v as ExplanationTier
  return TIER_ALIASES[v] ?? TIER_ALIASES[v.toLowerCase()] ?? null
}

export function tierProfile(tier: string | null | undefined): TierProfile {
  return TIER_PROFILES[(tier as ExplanationTier) in TIER_PROFILES ? (tier as ExplanationTier) : 'STANDARD']
}
