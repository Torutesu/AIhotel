// シーン別の説明動画 04: 外部需要動向
const N = (n, t) => `<b>${n}</b>${t}`
const SAMPLE = '※ 登録したイベント・新規ホテル以外の数値とコメントは、外部データ連携前のためサンプル表示です'

export default {
  kicker: 'SCENE 04',
  title: '外部需要動向',
  clips: [
    {
      type: 'title', dur: 4.6, num: '04', kicker: 'SCENE 04',
      title: '外部需要動向',
      sub: '気候・インバウンド・イベント・アクセス・新規ホテル。需要を動かす「外の要因」をまとめる画面です。',
      points: ['需要指数', '要因別の一覧', 'イベント登録', '新規ホテル登録', 'CSV 出力'],
    },
    {
      type: 'app',
      beats: [
        { dur: 5, shot: 'external', focus: 'full', highlight: 'notice', tag: N('1/5', '画面の全体'), note: SAMPLE, caption: '先6か月のマーケットの見通しを、要因ごとに整理します。' },
        { dur: 6, focus: 'monthly', highlight: true, label: '月別需要指数', tag: N('2/5', '需要指数'), note: SAMPLE, caption: '需要指数は「100 = 通常」。イベント・インバウンド・気候の要因を重ねて表示します。' },
        { dur: 6.4, focus: { region: 'factors', maxZoom: 1.25 }, tag: N('3/5', '要因の一覧'), note: SAMPLE, caption: '要因は5つ。それぞれ<em>一覧と CSV 出力</em>ができます。' },
        { dur: 6, focus: { region: 'events', pad: 60 }, highlight: 'events', label: '実データ（登録したイベント）', cursor: 'eventsOpen', click: true, tag: N('4/5', 'イベント'), caption: '<em>イベント</em>と<em>周辺の新規ホテル</em>は実データ。自分たちで登録して管理します。' },
        { dur: 6.4, dialog: 'external-events', focus: 'dialog', tag: N('4/5', 'イベント'), caption: '1件ずつの登録に加えて、<em>規定フォームの CSV</em> でまとめて取り込めます。' },
        { dur: 6.4, focus: 'dialog', tag: N('5/5', '予測への反映'), caption: '年末年始や台風などは<em>特殊日</em>として登録。その期間の実績を、予測の基準から外します。' },
      ],
    },
    {
      type: 'cards', dur: 7.8, kicker: 'まとめ', title: 'この画面でできること', cols: 3,
      items: [
        { t: 'イベントを登録する', d: '近隣のイベントを登録・CSV 取り込み。料金設定の画面にも表示されます。' },
        { t: '新規ホテルを記録する', d: '周辺の開業予定と客室数を登録し、供給の変化に備えます。' },
        { t: '特殊日を予測から外す', d: '例外的な日の実績が、ふだんの需要予測をゆがめないように。' },
      ],
      foot: '※ 気候・インバウンド・アクセスの数値と AI コメントは、外部データの取り込みと Claude API 連携の後に実データになります。',
    },
  ],
}
