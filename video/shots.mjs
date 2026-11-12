// 撮影する画面（ショット）の定義。capture.mjs がこの順に実アプリを操作して撮る。
// kind: 'viewport' = 1画面ぶんだけ / 'page' = 本文を全長で撮る / 'dialog' = 開いたダイアログを全長で撮る
// regions: 絵コンテ（storyboards/）から名前で参照する領域。
//   { block: '見出し' }        見出しを含むまとまり（カード・セクション）
//   { card: 'タイトル' }      タイトルがその文言で始まるカード
//   { text: '文言' }           その文言を持つ要素
//   { role: ['button', '名前'] }
//   { sel: 'CSS' , nth }       CSS セレクタ
//   { row: '11/21' }           その文言を含む表の行
//   { union: [spec, ...] }     複数領域を囲む矩形

const nav = (name) => async (page) => {
  await page.getByRole('button', { name, exact: true }).first().click()
}
const tab = (name) => async (page) => {
  await page.getByRole('tab', { name }).click()
}

export const VIEWPORT = { width: 1440, height: 810 }
export const DEMO_ROW = '11/21' // 日のAI分析で開く日（土曜・週末型）

export const shots = [
  {
    id: 'login',
    kind: 'viewport',
    beforeLogin: true,
    regions: {
      form: { sel: '[data-slot=card]' },
      button: { role: ['button', 'ログイン'] },
    },
  },
  {
    id: 'dashboard',
    kind: 'page',
    go: nav('ダッシュボード'),
    regions: {
      header: { union: [{ text: 'デモホテル東京' }, { text: '客室数' }] },
      alerts: { block: 'アラート' },
      alert1: { block: '2027年2月の着地見込み', minH: 80 },
      alert2: { block: '稼働率が予算を大幅に下回っています', minH: 80 },
      resolve: { role: ['button', '解決済みにする'] },
      ai: { block: 'AI解説' },
      month: { block: 'ここから下は対象年月の数値です', minH: 30, minW: 900 },
      curve: { block: '稼働・ADR月間推移' },
      compare: { block: '月初比較・日付比較' },
      kpi: { union: [{ text: 'KPI進捗状況' }, { sel: 'main table', nth: 2 }] },
      kpiTabCum: { role: ['button', '累計進捗'] },
      inventory: { block: '在庫表' },
      navPricing: { role: ['button', 'ダイナミックプライシング'] },
    },
  },
  {
    id: 'dashboard-cum',
    kind: 'page',
    go: async (page) => {
      await page.getByRole('button', { name: '累計進捗' }).click()
    },
    regions: {
      kpi: { union: [{ text: 'KPI進捗状況' }, { sel: 'main table', nth: 2 }] },
      kpiTabFy: { role: ['button', /年度/] },
    },
  },
  {
    id: 'pricing',
    kind: 'page',
    go: nav('ダイナミックプライシング'),
    regions: {
      title: { text: 'ダイナミックプライシング', scope: 'main' },
      ai: { block: 'AI価格最適化の提案' },
      landing: { union: [{ text: '着地予測（2026年11月）' }, { text: /^着地予測室料売上/ }, { role: ['button', 'AI予測値へリセット'] }] },
      reset: { role: ['button', 'AI予測値へリセット'] },
      calendarHead: { union: [{ text: '日別価格カレンダー（2026年11月）' }, { row: '11/6' }] },
      calendar: { sel: 'main table', nth: 0 },
      weekend: { union: [{ row: '11/20' }, { row: '11/21' }] },
      row: { row: DEMO_ROW },
      typeSelect: { sel: 'main [role=combobox]', nth: 2 },
      onhand: { block: 'オンハンド状況' },
      events: { block: '当月のイベント情報' },
    },
  },
  {
    id: 'pricing-day',
    kind: 'dialog',
    go: async (page) => {
      await page.locator('main tr', { hasText: DEMO_ROW }).first().click()
    },
    regions: {
      head: { sel: '[role=dialog] h2' },
      daytype: { block: '日のタイプと優先モデル' },
      curve: { block: 'この日のブッキングカーブ' },
      similar: { block: '同じタイプの日' },
      rec: { union: [{ block: '推奨価格 & 料金ランク', minH: 60, minW: 150 }, { block: '競合価格水準', minH: 60, minW: 150 }] },
      insight: { block: 'AI分析インサイト' },
      sim: { block: 'この日のシミュレーション' },
    },
  },
  {
    id: 'pricing-type',
    kind: 'page',
    go: async (page) => {
      await page.keyboard.press('Escape')
      await page.waitForTimeout(500)
      await page.locator('main [role=combobox]').nth(2).click()
      await page.getByRole('option').nth(1).click()
    },
    regions: {
      calendar: { sel: 'main table', nth: 0 },
      typeSelect: { sel: 'main [role=combobox]', nth: 2 },
    },
  },
  {
    id: 'analysis-trend',
    kind: 'page',
    go: async (page) => {
      await nav('分析')(page)
      await page.waitForTimeout(800)
      await tab('実績推移')(page)
    },
    regions: {
      insight: { block: '分析インサイト' },
      tabs: { sel: '[role=tablist]' },
      summary: { block: '2026年11月のサマリー' },
      daily: { block: '日別パフォーマンス（2026年11月）' },
      dailyToggle: { role: ['button', '差異で見る'] },
      graphs: { union: [{ text: /^月のグラフ/ }, { text: /^その時点の予約室数で比べます/ }] },
      weekday: { block: '曜日別パフォーマンス（2026年11月）' },
      daytype: { block: '日のタイプ別パフォーマンス（2026年11月）' },
      yearly: { union: [{ block: '売上推移比較' }, { block: 'REV-Per推移' }] },
      tabMix: { role: ['tab', '需要構成'] },
    },
  },
  {
    id: 'analysis-variance',
    kind: 'page',
    go: async (page) => {
      await page.getByRole('button', { name: '差異で見る' }).click()
    },
    regions: { daily: { block: '日別パフォーマンス（2026年11月）' } },
  },
  {
    id: 'analysis-mix',
    kind: 'page',
    go: tab('需要構成'),
    regions: {
      tabs: { sel: '[role=tablist]' },
      channel: { block: 'チャネル別（2026年11月）' },
      roomtype: { block: '部屋タイプ別（2026年11月）' },
      guests: { block: '利用人数別' },
      tabBooking: { role: ['tab', '予約動向'] },
    },
  },
  {
    id: 'analysis-booking',
    kind: 'page',
    go: tab('予約動向'),
    regions: {
      tabs: { sel: '[role=tablist]' },
      curve: { block: 'ブッキングカーブグラフ' },
      lead: { block: 'リードタイム分析' },
      tabComp: { role: ['tab', '競合比較'] },
    },
  },
  {
    id: 'analysis-competitor',
    kind: 'page',
    go: tab('競合比較'),
    regions: {
      tabs: { sel: '[role=tablist]' },
      compare: { union: [{ text: '競合ホテルとの価格比較分析' }, { row: '11/19' }] },
      level: { block: '競合ホテル別の価格水準' },
      list: { block: '競合ホテル一覧' },
      reviews: { block: '口コミ評価点' },
    },
  },
  {
    id: 'analysis-ota',
    kind: 'page',
    go: tab('OTA販促状況'),
    regions: { tabs: { sel: '[role=tablist]' }, list: { block: '販促内容一覧' } },
  },
  {
    id: 'reports',
    kind: 'page',
    go: nav('レポート'),
    pdf: true,
    regions: {
      controls: { sel: 'main [data-slot=card]', nth: 0 },
      format: { sel: 'main [role=combobox]', nth: 3 },
      download: { role: ['button', 'レポートをダウンロード'] },
      content: { block: '月次レポートの内容' },
    },
  },
  {
    id: 'external',
    kind: 'page',
    go: nav('外部需要動向'),
    regions: {
      notice: { block: 'サンプル表示（未接続）', minH: 20, minW: 900 },
      ai: { block: 'AI総合予測コメント' },
      monthly: { block: '月別需要指数予測' },
      weekly: { block: '週別需要予測' },
      factors: { union: [{ card: '気候要因' }, { card: '新規ホテル' }, { card: 'イベント' }] },
      events: { card: 'イベント' },
      eventsOpen: { text: /^一覧・登録・CSV$/, nth: 0 },
      newHotels: { card: '新規ホテル' },
      notes: { block: '今後の注意事項' },
    },
  },
  {
    id: 'external-events',
    kind: 'dialog',
    go: async (page) => {
      await page.getByText('一覧・登録・CSV', { exact: true }).first().click()
    },
    regions: { head: { sel: '[role=dialog] h2' } },
  },
  {
    id: 'settings',
    kind: 'page',
    go: async (page) => {
      await page.keyboard.press('Escape')
      await page.waitForTimeout(500)
      await nav('設定')(page)
    },
    regions: {
      hotel: { card: 'ホテル情報' },
      weekend: { block: '週末定義', minH: 60, minW: 600 },
      setup: { card: '初期設定の一括投入と連携先' },
      roomTypes: { block: '部屋タイプ' },
      ranks: { block: '料金ランク設定' },
      weights: { block: '価格戦略の重み付け' },
      adjust: { block: '推奨の調整' },
      budget: { block: '予算' },
      importDaily: { block: '実績データの取り込み' },
      importOtb: { block: '予約数（OTB）の取り込み' },
      competitors: { card: '競合ホテル' },
      users: { block: 'ユーザー管理' },
      audit: { block: '監査ログ' },
      ip: { block: 'IP アドレス制限' },
      security: { block: 'アカウントのセキュリティ' },
      display: { block: 'ダッシュボード表示設定' },
    },
  },
]
