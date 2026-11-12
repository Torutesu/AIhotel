// シーン別の説明動画 01: ダッシュボード
const N = (n, t) => `<b>${n}</b>${t}`
const SAMPLE_AI = '※ 解説文の自動生成（Claude API 連携）は今後対応。現在は登録済みの文面を表示しています'

export default {
  kicker: 'SCENE 01',
  title: 'ダッシュボード',
  clips: [
    {
      type: 'title', dur: 4.6, num: '01', kicker: 'SCENE 01',
      title: 'ダッシュボード',
      sub: 'ログインして最初に開く画面。いま対応することと、対象年月の数値を1枚で確認します。',
      points: ['アラート', 'AI解説', '稼働・ADR月間推移', 'KPI進捗', '在庫表'],
    },
    {
      type: 'app',
      beats: [
        { dur: 4.6, shot: 'dashboard', focus: 'full', tag: N('1/8', '画面の全体'), caption: '上は<em>現在〜先々のお知らせ</em>、下は<em>対象年月の数値</em>。上から順に見れば、今日やることが分かります。' },
        { dur: 5.6, focus: 'alerts', highlight: true, label: 'アラート', tag: N('2/8', 'アラート'), caption: 'アラートは重要度5段階。ダッシュボードには <em>Level 5・4</em> だけを出します。' },
        { dur: 6.2, focus: { region: 'alert1', pad: 90 }, highlight: 'alert1', label: '先々の月の注意点', tag: N('2/8', 'アラート'), caption: '当月だけでなく<em>先々の月</em>も対象。着地見込みが予算を下回ると、日次バッチが見つけて知らせます。' },
        { dur: 5.4, focus: { region: 'alert1', pad: 90 }, highlight: 'alert1', cursor: 'resolve', tag: N('2/8', 'アラート'), caption: 'リンクから該当の画面・日付へ。対応したら<em>「解決済み」</em>にすると一覧から外れます。' },
        { dur: 5.6, focus: 'ai', highlight: true, label: 'AI解説', tag: N('3/8', 'AI解説'), note: SAMPLE_AI, caption: 'AI解説は、<em>【当月】</em>と<em>【先々】</em>の見通しを文章でまとめる欄です。' },
        { dur: 7.2, focus: 'curve', highlight: true, label: '稼働・ADR月間推移', tag: N('4/8', '稼働・ADR月間推移'), caption: '宿泊日を選ぶと、予約がどう積み上がったかを<em>前年同曜日のカーブ</em>と比べます。CSV・画像でも出力できます。' },
        { dur: 6.2, focus: 'compare', highlight: true, label: '月初比較・日付比較', tag: N('5/8', '月初比較・日付比較'), caption: '月初や任意の日に記録した<em>スナップショット</em>と、いまの数値の差を確認します。' },
        { dur: 6.4, focus: { region: 'kpi', pad: 40 }, highlight: 'kpi', label: 'KPI進捗状況', cursor: 'kpiTabCum', click: true, tag: N('6/8', 'KPI進捗'), caption: '室料売上・ADR・稼働率・REV-Per などの進捗。<em>予算比・前年比</em>と着地予測が並びます。' },
        { dur: 5.2, shot: 'dashboard-cum', focus: { region: 'kpi', pad: 40 }, highlight: 'kpi', label: '累計進捗', tag: N('7/8', '3つの軸'), caption: '<em>「本日まで」「累計進捗」「年度累計」</em>の3つの軸で切り替えられます（年度は4月始まり）。' },
        { dur: 6.2, shot: 'dashboard', focus: 'inventory', highlight: true, label: '在庫表', tag: N('8/8', '在庫表'), note: '※ 在庫表は PMS 連携と残室推移の記録が未実装のため、サンプル表示です', caption: '在庫表は、選んだ日から14日ぶんの残室を部屋タイプ別に並べます。' },
      ],
    },
    {
      type: 'cards', dur: 8.2, kicker: 'まとめ', title: 'この画面でできること', cols: 3,
      items: [
        { t: 'やることから先に見る', d: '重要度の高いアラートだけを上に。当月も先々の月も対象です。' },
        { t: '月の進み具合を数字で', d: 'KPI を予算比・前年比・着地予測と並べ、3つの軸で確認。' },
        { t: '過去の時点と比べる', d: '月初や任意の日のスナップショットと、現在の差が分かります。' },
      ],
      foot: '※ アラートの閾値は暫定値です。AI解説の自動生成と在庫表の実データ表示は、外部連携の後に対応します。',
    },
  ],
}
