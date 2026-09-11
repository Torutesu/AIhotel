// 個社MDの「## ルール」節の解釈（docs/外部要因設計.md §7）。DB 非依存の純粋ロジック。
//
// ヒアリングで決めた方針のうち、機械が読める項目だけを固定の語彙で書く:
//   最小ランク: 8
//   最大ランク: 36
//   最低価格: 9800
//   最大変動幅: 3
//   競合ポジション: +5%
//   除外競合: 競合ホテルC, 競合ホテルD
//   需要レベルA: 下げない。満室が見えたら1段上げる
//   需要レベルE: 最低価格を割らない範囲で需要喚起
//   団体: 10室以上は個別判断（自動採用しない）
//   効かない要因: 天候, 学校休暇
//   効く要因: 連休前夜
//   自動採用: オフ
//   禁止: 前年同日より2段以上下げない
// 解釈できない行は errors に残し、黙って無視しない。数値の係数はここに書かせない（学習と二重管理になる）。

export type FactorGroup = 'weather' | 'event' | 'school' | 'holiday' | 'special' | 'comp' | 'weekend'

export interface HotelRules {
  minRank?: number
  maxRank?: number
  /** 円。ランク表から最小ランクに変換する（apply 時） */
  minPrice?: number
  maxDailyRankChange?: number
  competitorPositionPct?: number
  excludedCompetitors: string[]
  levelPolicies: Partial<Record<'A' | 'B' | 'C' | 'D' | 'E', string>>
  groupPolicy?: string
  disabledFactorGroups: FactorGroup[]
  enabledFactorGroups: FactorGroup[]
  autoAdopt?: boolean
  prohibitions: string[]
  notes: string[]
}

export interface RuleParseError {
  line: number
  text: string
  reason: string
}

export interface RuleParseResult {
  rules: HotelRules
  errors: RuleParseError[]
  /** ルール節が見つかったか */
  found: boolean
}

export const FACTOR_GROUP_ALIASES: Record<string, FactorGroup> = {
  天候: 'weather',
  天気: 'weather',
  雨: 'weather',
  イベント: 'event',
  催事: 'event',
  学校休暇: 'school',
  春休み: 'school',
  夏休み: 'school',
  冬休み: 'school',
  祝日: 'holiday',
  連休: 'holiday',
  特別期間: 'special',
  GW: 'special',
  お盆: 'special',
  年末年始: 'special',
  競合: 'comp',
  競合価格: 'comp',
  売止め: 'comp',
  週末: 'weekend',
}

export const FACTOR_GROUP_LABELS: Record<FactorGroup, string> = {
  weather: '天候',
  event: 'イベント',
  school: '学校休暇',
  holiday: '祝日・連休',
  special: '特別期間',
  comp: '競合',
  weekend: '週末',
}

/** 要因グループ → 係数キーの接頭辞（factorDefaults.ts のキー体系） */
export const FACTOR_GROUP_PREFIX: Record<FactorGroup, string> = {
  weather: 'weather:',
  event: 'event:',
  school: 'school:',
  holiday: 'holiday:',
  special: 'special:',
  comp: 'comp:',
  weekend: 'weekend:',
}

function emptyRules(): HotelRules {
  return { excludedCompetitors: [], levelPolicies: {}, disabledFactorGroups: [], enabledFactorGroups: [], prohibitions: [], notes: [] }
}

function toHalfWidth(s: string): string {
  return s.replace(/[０-９＋－％：，]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/　/g, ' ')
}

function parseInteger(v: string): number | null {
  const m = /^[+-]?\d+$/.exec(v.replace(/[,円段ランク%]/g, '').trim())
  return m ? Number(m[0]) : null
}

function splitList(v: string): string[] {
  return v
    .split(/[,、，/／]/)
    .map((x) => x.trim())
    .filter(Boolean)
}

function parseGroups(v: string): { groups: FactorGroup[]; unknown: string[] } {
  const groups: FactorGroup[] = []
  const unknown: string[] = []
  for (const item of splitList(v)) {
    const g = FACTOR_GROUP_ALIASES[item] ?? (Object.values(FACTOR_GROUP_LABELS).includes(item) ? (Object.entries(FACTOR_GROUP_LABELS).find(([, l]) => l === item)?.[0] as FactorGroup) : undefined)
    if (g) {
      if (!groups.includes(g)) groups.push(g)
    } else unknown.push(item)
  }
  return { groups, unknown }
}

/** 「## ルール」節（次の ## まで）の行を取り出す */
export function extractRulesSection(markdown: string): { lines: Array<{ line: number; text: string }>; found: boolean } {
  const lines = markdown.split(/\r?\n/)
  const out: Array<{ line: number; text: string }> = []
  let inside = false
  let found = false
  lines.forEach((raw, i) => {
    const h = /^#{2,3}\s+(.+)$/.exec(raw)
    if (h) {
      const title = h[1].trim()
      if (/^ルール/.test(title)) {
        inside = true
        found = true
        return
      }
      if (inside && /^##\s/.test(raw)) inside = false
      if (inside) return
      return
    }
    if (inside) out.push({ line: i + 1, text: raw })
  })
  return { lines: out, found }
}

/**
 * ルール節を HotelRules に変換する
 */
export function parseHotelRules(markdown: string): RuleParseResult {
  const rules = emptyRules()
  const errors: RuleParseError[] = []
  const { lines, found } = extractRulesSection(markdown)
  if (!found) return { rules, errors, found: false }

  for (const { line, text } of lines) {
    const stripped = toHalfWidth(text).replace(/^\s*[-*・]\s*/, '').trim()
    if (!stripped || stripped.startsWith('<!--')) continue
    const m = /^([^:：]+?)\s*[:：]\s*(.*)$/.exec(stripped)
    if (!m) {
      errors.push({ line, text, reason: '「キー: 値」の形式ではありません' })
      continue
    }
    const key = m[1].trim()
    const value = m[2].trim()
    const fail = (reason: string) => errors.push({ line, text, reason })

    if (key === '最小ランク' || key === '最低ランク') {
      const n = parseInteger(value)
      n != null && n >= 1 && n <= 40 ? (rules.minRank = n) : fail('1〜40 の整数で指定してください')
    } else if (key === '最大ランク' || key === '上限ランク') {
      const n = parseInteger(value)
      n != null && n >= 1 && n <= 40 ? (rules.maxRank = n) : fail('1〜40 の整数で指定してください')
    } else if (key === '最低価格' || key === 'フロア価格') {
      const n = parseInteger(value)
      n != null && n > 0 ? (rules.minPrice = n) : fail('円の整数で指定してください')
    } else if (key === '最大変動幅' || key === '1日の最大変動' || key === '変動幅') {
      const n = parseInteger(value)
      n != null && n >= 1 && n <= 40 ? (rules.maxDailyRankChange = n) : fail('1〜40 の整数で指定してください')
    } else if (key === '競合ポジション' || key === '競合比') {
      const n = parseInteger(value)
      n != null && n >= -50 && n <= 50 ? (rules.competitorPositionPct = n) : fail('-50〜+50 の % で指定してください（例 +5%）')
    } else if (key === '除外競合' || key === '競合除外') {
      rules.excludedCompetitors.push(...splitList(value))
    } else if (/^需要レベル\s*([A-Ea-e])$/.test(key)) {
      const lvl = /^需要レベル\s*([A-Ea-e])$/.exec(key)![1].toUpperCase() as 'A' | 'B' | 'C' | 'D' | 'E'
      value ? (rules.levelPolicies[lvl] = value) : fail('方針を書いてください')
    } else if (key === '団体' || key === '団体客') {
      rules.groupPolicy = value
    } else if (key === '効かない要因' || key === '無効な要因' || key === '使わない要因') {
      const { groups, unknown } = parseGroups(value)
      rules.disabledFactorGroups.push(...groups.filter((g) => !rules.disabledFactorGroups.includes(g)))
      if (unknown.length) fail(`不明な要因です: ${unknown.join(', ')}（使える語: ${Object.values(FACTOR_GROUP_LABELS).join(', ')}）`)
    } else if (key === '効く要因' || key === '有効な要因') {
      const { groups, unknown } = parseGroups(value)
      rules.enabledFactorGroups.push(...groups.filter((g) => !rules.enabledFactorGroups.includes(g)))
      if (unknown.length) fail(`不明な要因です: ${unknown.join(', ')}`)
    } else if (key === '自動採用') {
      if (/^(オン|on|有効|する|true)$/i.test(value)) rules.autoAdopt = true
      else if (/^(オフ|off|無効|しない|false)$/i.test(value)) rules.autoAdopt = false
      else fail('オン / オフ で指定してください')
    } else if (key === '禁止' || key === '禁止事項' || key === 'NG') {
      rules.prohibitions.push(value)
    } else if (key === '備考' || key === 'メモ' || key === '補足') {
      rules.notes.push(value)
    } else {
      fail(`不明なキーです: ${key}`)
    }
  }

  if (rules.minRank != null && rules.maxRank != null && rules.minRank > rules.maxRank) {
    errors.push({ line: 0, text: '', reason: '最小ランクが最大ランクを超えています' })
  }
  const conflict = rules.disabledFactorGroups.filter((g) => rules.enabledFactorGroups.includes(g))
  if (conflict.length) errors.push({ line: 0, text: '', reason: `効く要因と効かない要因が矛盾しています: ${conflict.map((g) => FACTOR_GROUP_LABELS[g]).join(', ')}` })

  return { rules, errors, found: true }
}

/**
 * チャット・AIまとめのシステムプロンプトに載せる要約（数字と方針だけ、短く）
 */
export function summarizeRulesForPrompt(rules: HotelRules | null | undefined): string {
  if (!rules) return ''
  const parts: string[] = []
  if (rules.minRank != null || rules.maxRank != null) parts.push(`ランク範囲 R${rules.minRank ?? 1}〜R${rules.maxRank ?? 40}`)
  if (rules.minPrice != null) parts.push(`最低価格 ${rules.minPrice.toLocaleString('ja-JP')}円`)
  if (rules.maxDailyRankChange != null) parts.push(`1回の最大変動 ±${rules.maxDailyRankChange}`)
  if (rules.competitorPositionPct != null) parts.push(`競合比 ${rules.competitorPositionPct >= 0 ? '+' : ''}${rules.competitorPositionPct}%`)
  if (rules.excludedCompetitors.length) parts.push(`除外競合: ${rules.excludedCompetitors.join('・')}`)
  for (const [lvl, policy] of Object.entries(rules.levelPolicies)) parts.push(`需要レベル${lvl}: ${policy}`)
  if (rules.groupPolicy) parts.push(`団体: ${rules.groupPolicy}`)
  if (rules.disabledFactorGroups.length) parts.push(`効かない要因（係数固定0）: ${rules.disabledFactorGroups.map((g) => FACTOR_GROUP_LABELS[g]).join('・')}`)
  if (rules.autoAdopt != null) parts.push(`自動採用: ${rules.autoAdopt ? 'オン' : 'オフ'}`)
  for (const p of rules.prohibitions) parts.push(`禁止: ${p}`)
  return parts.join(' / ')
}
