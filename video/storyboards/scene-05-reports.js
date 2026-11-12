// シーン別の説明動画 05: レポート
const N = (n, t) => `<b>${n}</b>${t}`

export default {
  kicker: 'SCENE 05',
  title: 'レポート',
  clips: [
    {
      type: 'title', dur: 4.4, num: '05', kicker: 'SCENE 05',
      title: 'レポート',
      sub: '対象月の実績・予算・日別明細を、PDF または Excel で出力します。',
      points: ['月次レポート', 'PDF', 'Excel'],
    },
    {
      type: 'app',
      beats: [
        { dur: 4.6, shot: 'reports', focus: 'full', tag: N('1/3', '画面の全体'), caption: '操作は3つ選ぶだけ。レポートタイプ・対象期間・出力形式です。' },
        { dur: 5.6, focus: { region: 'controls', pad: 60 }, highlight: 'controls', label: '対象月と形式を選ぶ', cursor: 'download', click: true, tag: N('2/3', '出力'), caption: '対象月を選んで<em>「レポートをダウンロード」</em>を押すと…' },
        { dur: 7.4, focus: 'full', paper: true, tag: N('2/3', '出力'), caption: 'その月の<em>月次レポート</em>が PDF で出力されます。日本語フォントを同梱しているので、そのまま配布できます。' },
        { dur: 6.4, focus: { region: 'content', pad: 50 }, highlight: 'content', label: 'レポートの内容', tag: N('3/3', '内容'), caption: '内容は、月間サマリー・予算と前年実績との比較・日別明細。<em>Excel</em> でも同じ内容を出力できます。' },
      ],
    },
    {
      type: 'cards', dur: 7, kicker: 'まとめ', title: 'この画面でできること', cols: 3,
      items: [
        { t: '月次レポートを作る', d: '対象月を選ぶだけ。集計は実績データから自動で行います。' },
        { t: 'PDF で共有する', d: '会議や報告にそのまま使える体裁で出力します。' },
        { t: 'Excel で加工する', d: '日別明細を Excel で受け取り、手元で集計を続けられます。' },
      ],
    },
  ],
}
