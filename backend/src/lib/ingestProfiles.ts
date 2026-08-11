// 取込プロファイル（F-ING-01 — docs/pms-ingest-design.md §5）
//
// PMS/サイトコントローラーごとの「列名の違い」をコード分岐ではなく設定データで吸収する。
// 新しいツールに対応する作業 = このファイルにプロファイルを1つ足すだけ（正規化・送信層は変更なし）。
//
// 左辺（共通項目）は取込APIのzodスキーマ（lib/validators.ts の ingest*RowSchema）と1:1。
// 右辺（ソース列名）だけを差し替えれば別ツールに対応できる。

export type IngestDataset = 'nights' | 'reservations' | 'inventory'

/** 値の変換指定。ソース表現の揺れを吸収する */
export type TransformSpec =
  | 'date' // Date / "2025-01-01" / "2025/1/1" → Date
  | 'number' // "1,234" / " 1234 " → number
  | 'integer'
  | 'flag01' // "0"/"1"/"true" → boolean
  | 'trim' // 前後空白除去（既定）

export interface DatasetProfile {
  /** 共通項目名（ドット区切りで入れ子可） → ソース列名 */
  map: Record<string, string>
  /** 共通項目名 → 変換指定。未指定なら値をそのまま渡す */
  transforms?: Record<string, TransformSpec>
  /**
   * 意図的に取り込まない列。
   * ADR・泊数・リードタイム等の「計算で再現できる列」は二重定義を避けるため取り込まない。
   */
  ignoredColumns?: string[]
}

export interface IngestProfile {
  id: string
  displayName: string
  /** 想定するファイル形式。実ファイルの拡張子から自動判定もするため参考値 */
  format: 'csv' | 'excel'
  /** CSVの文字コード。PMSのCSV出力はShift_JISが多い */
  encoding?: 'utf8' | 'shift_jis'
  /** Excelの対象シート選択。未指定なら最初のシート */
  sheet?: { name?: string; namePattern?: string; index?: number }
  /** ヘッダ行の位置（1始まり） */
  headerRow: number
  datasets: Partial<Record<IngestDataset, DatasetProfile>>
  notes?: string
}

// ======================================
// 新宿ワシントン（HG）実績CSV
// 出典: Drive「新宿ワシントンデータ/HG2025年CSV.zip」CSV20250xHG.xlsx
// 実ファイルは40列。うち計算列は取り込まない（ignoredColumns）。
// ======================================
const HG_NIGHTS: DatasetProfile = {
  map: {
    stayDate: '計上日',
    roomTypeCode: '部屋タイプ',
    rateTypeCode: '料金タイプ',
    packageCode: 'パッケージコード',
    rooms: '室数',
    guests: '人数計',
    'guestsDetail.male': '男人数',
    'guestsDetail.female': '女人数',
    'guestsDetail.child': '子供人数',
    roomRevenue: '室料NET',
    serviceFee: 'サービス',
    agentCode: 'エージェントコード',
    regionCode: '地域コード',
    marketCode: 'Market(市場)コード',
    individualGroupType: '個人団体区分',
    buildingCode: '棟コード',
    blockCode: 'ブロック',
    checkIn: 'チェックイン日',
    checkOut: 'チェックアウト日',
    isDayUse: 'デイユースフラグ',
    compHuType: 'COMP/HU区分',
  },
  transforms: {
    stayDate: 'date',
    checkIn: 'date',
    checkOut: 'date',
    rooms: 'integer',
    guests: 'integer',
    'guestsDetail.male': 'integer',
    'guestsDetail.female': 'integer',
    'guestsDetail.child': 'integer',
    roomRevenue: 'number',
    serviceFee: 'number',
    isDayUse: 'flag01',
  },
  // ADR・サ込み・泊数・件数・リードタイムはシステム側で再計算するため取り込まない。
  // Rタイプ/タイプ/エリア1〜4/種別1〜2/施策/BS/BS2 はコードマスター由来の表示名・派生列。
  ignoredColumns: [
    '曜日',
    'Rタイプ',
    'タイプ',
    'サ込み',
    'ADR',
    '種別1',
    '種別2',
    '施策',
    'エリア1',
    'エリア2',
    'エリア3',
    'エリア4',
    'BS',
    'BS2',
    '処理日',
    '使用人数',
    '泊数',
    '件数',
    'リードタイム',
  ],
}

export const INGEST_PROFILES: IngestProfile[] = [
  {
    id: 'hg-nights',
    displayName: '新宿ワシントン 実績CSV（計上日単位）',
    format: 'excel',
    // 同一ブックに「コードマスター7」シートが同梱されるため、データシートを名前で選ぶ
    sheet: { namePattern: '^CSV\\d+' },
    headerRow: 1,
    datasets: { nights: HG_NIGHTS },
    notes:
      'コードマスター7シートはセグメントマスタ（PUT /settings/segments）へ別途取り込む。' +
      'CSV形式で出力される場合は format=csv / encoding=shift_jis のプロファイルを別途用意する。',
  },
  {
    // 上と同じ列構成でCSV（Shift_JIS）出力された場合に使う。
    // PMSのCSV出力は Shift_JIS が多いため既定で用意しておく。
    id: 'hg-nights-csv',
    displayName: '新宿ワシントン 実績CSV（CSV/Shift_JIS）',
    format: 'csv',
    encoding: 'shift_jis',
    headerRow: 1,
    datasets: { nights: HG_NIGHTS },
  },
]

export function findProfile(id: string): IngestProfile | undefined {
  return INGEST_PROFILES.find((p) => p.id === id)
}

/**
 * 個人情報カラムの二次防御（仕様書Ⅲ章3.3）。
 * 一次防御はPMS側の出力設定だが、設定漏れに備えてヘッダ名でも弾く。
 * 「氏名」「住所」等が列に含まれるファイルは取り込まない。
 */
const PII_HEADER_PATTERNS: RegExp[] = [
  /氏\s*名/,
  /^名前$/,
  /宿泊者名/,
  /代表者名/,
  /住\s*所/,
  /電\s*話/,
  /TEL/i,
  /携帯/,
  /メール/,
  /E-?MAIL/i,
  /予約番号/,
  /会員番号/,
  /クレジット/,
  /カード番号/,
]

export function detectPiiColumns(headers: string[]): string[] {
  return headers.filter((h) => PII_HEADER_PATTERNS.some((re) => re.test(h)))
}
