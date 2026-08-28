// 団体客のレベニュー影響ルール（SAAS_DECISIONS.md D-09）。
//
// 自由記述にすると施設ごとに書き方が変わり、集計も比較もできなくなる。
// プリセットをコード側（L1 システム固定）で定義し、DBには
// { presetKey, params, note } の形で保存する。
// プリセットの追加はこの配列に足すだけでよく、マイグレーションを伴わない。

export interface GroupBookingPreset {
  key: string
  label: string
  description: string
  /** このプリセットで使う追加パラメータ（無ければ空） */
  params: Array<{ key: string; label: string; type: 'number'; required: boolean }>
}

export const GROUP_BOOKING_PRESETS: GroupBookingPreset[] = [
  {
    key: 'displacement',
    label: '個人需要を押し出す',
    description:
      '満室に近い日に入る団体で、通常なら販売できた個人客の枠を占有する。' +
      '機会損失を織り込んで評価するため、団体単価が個人単価を下回る場合は要注意として扱う。',
    params: [],
  },
  {
    key: 'incremental',
    label: '追加需要（押し出しなし）',
    description:
      '空室が多い日に入る団体で、個人客の販売を妨げない。稼働率・売上の純増として扱う。',
    params: [],
  },
  {
    key: 'rate_protected',
    label: '期間中の料金下限を維持',
    description:
      '団体受入と引き換えに、同期間の販売価格を一定額以上に保つ契約。' +
      'AI推奨価格がこの下限を下回らないようにする。',
    params: [{ key: 'floorPrice', label: '最低料金（円・1名あたり）', type: 'number', required: true }],
  },
  {
    key: 'excluded_from_kpi',
    label: 'KPI集計から除外',
    description:
      '社内利用・招待客など、ADR や稼働率の評価から外すべき予約。売上には計上するが指標には含めない。',
    params: [],
  },
]

export const GROUP_BOOKING_PRESET_KEYS = GROUP_BOOKING_PRESETS.map((p) => p.key)

export function findGroupBookingPreset(key: string): GroupBookingPreset | undefined {
  return GROUP_BOOKING_PRESETS.find((p) => p.key === key)
}
