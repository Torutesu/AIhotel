// シーン別の説明動画 03: 分析
const N = (n, t) => `<b>${n}</b>${t}`

export default {
  kicker: 'SCENE 03',
  title: '分析',
  clips: [
    {
      type: 'title', dur: 4.6, num: '03', kicker: 'SCENE 03',
      title: '分析',
      sub: '日次の実績から、需要構成・予約動向・競合比較までを1つの画面で確認します。',
      points: ['実績推移', '需要構成', '予約動向', '競合比較', 'OTA販促状況', 'フリー分析'],
    },
    {
      type: 'app',
      beats: [
        { dur: 4.8, shot: 'analysis-trend', focus: { region: 'tabs', zoom: 'full' }, scroll: 330, highlight: 'tabs', label: '6つのタブ', tag: N('1/9', 'タブの構成'), caption: '分析は6つのタブ。対象期間を選ぶと、すべてのタブがその月に切り替わります。' },
        { dur: 5.8, focus: 'summary', highlight: true, label: '月のサマリー', tag: N('2/9', '実績推移'), caption: '<em>実績推移</em>のサマリーは事実だけ。前月以前は実績、当月以降は<em>実績＋予約</em>で集計します。' },
        { dur: 6.2, focus: { region: 'daily', maxZoom: 1.35 }, highlight: 'daily', label: '日別パフォーマンス', cursor: 'dailyToggle', click: true, tag: N('3/9', '日別パフォーマンス'), caption: '日別パフォーマンス。販売室数・稼働率・ADR を、<em>実数・AIの想定・予算</em>で横に並べます。' },
        { dur: 5.4, shot: 'analysis-variance', focus: { region: 'daily', maxZoom: 1.35 }, highlight: 'daily', label: '差異で見る', tag: N('3/9', '日別パフォーマンス'), caption: '<em>「差異で見る」</em>に切り替えると、予算差異・AI想定差異・前年比の表になります。' },
        { dur: 5.8, shot: 'analysis-trend', focus: 'graphs', highlight: true, label: '月のグラフ・日のグラフ', tag: N('4/9', '推移のグラフ'), caption: '月全体と選んだ日について、<em>180日前から結果まで</em>の差の動きを追えます。' },
        { dur: 6.4, focus: 'daytype', highlight: true, label: '日のタイプ別パフォーマンス', tag: N('5/9', '曜日別・日のタイプ別'), caption: '曜日別に加えて<em>日のタイプ別</em>。どの型の日が稼働と単価を作っているかが分かります。' },
        { dur: 5.8, focus: { region: 'yearly', maxZoom: 1.2 }, tag: N('6/9', '年間推移'), caption: '年間推移は月単位。売上・ADR・稼働率・REV-Per を並べて見られます。' },
        { dur: 7, shot: 'analysis-mix', focus: { region: 'channel', maxZoom: 1.3 }, highlight: 'channel', label: 'チャネル別', tag: N('7/9', '需要構成'), note: '※ 客単価・DOR・平均宿泊数と「利用人数別」は、予約明細の取り込み前のためサンプル表示です', caption: '<em>需要構成</em>はチャネル別・部屋タイプ別。販売室数・ADR・売上構成比・前年同月比を同じ表でそろえます。' },
        { dur: 5.8, shot: 'analysis-booking', focus: 'curve', highlight: true, label: 'ブッキングカーブ', tag: N('8/9', '予約動向'), note: '※ リードタイム分析は予約明細の集計が未実装のため、サンプル表示です', caption: '<em>予約動向</em>はブッキングカーブとリードタイム分析。予約がいつ入るかを見ます。' },
        { dur: 6.6, shot: 'analysis-competitor', focus: { region: 'compare', maxZoom: 1.3 }, highlight: 'compare', label: '競合ホテルとの価格比較', tag: N('9/9', '競合比較'), caption: '<em>競合比較</em>は日別・利用人数別。当ホテルとの価格差と差額率を、1社ずつ並べます。' },
        { dur: 6, focus: 'reviews', highlight: true, label: '口コミ評価点', tag: N('9/9', '競合比較'), caption: '価格水準は「平均」ではなく<em>中央値</em>で。OTA別の口コミ評価点と推移も確認できます。' },
      ],
    },
    {
      type: 'cards', dur: 8.2, kicker: 'まとめ', title: 'この画面でできること', cols: 3,
      items: [
        { t: '想定と結果の差を見る', d: '日ごとに、実数・AIの想定・予算を並べて差異を確認。' },
        { t: 'どこから売れたかを知る', d: 'チャネル別・部屋タイプ別の構成を、前年同月と比較。' },
        { t: '競合との位置を確かめる', d: '日別・人数別の価格差と、OTA別の口コミ評価点。' },
      ],
      foot: '※ OTA販促状況・リードタイム分析・利用人数別はサンプル表示です（画面にも明示しています）。競合価格の自動取得は順次対応します。',
    },
  ],
}
