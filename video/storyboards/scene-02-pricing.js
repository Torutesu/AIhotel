// シーン別の説明動画 02: ダイナミックプライシング
const N = (n, t) => `<b>${n}</b>${t}`

export default {
  kicker: 'SCENE 02',
  title: 'ダイナミックプライシング',
  clips: [
    {
      type: 'title', dur: 4.6, num: '02', kicker: 'SCENE 02',
      title: 'ダイナミック<br>プライシング',
      sub: '予算・いまの予約・推奨を1つの表で見比べて、日ごとの料金ランクを決める画面です。',
      points: ['着地予測', '日別価格カレンダー', '日のAI分析', 'シミュレーション'],
    },
    {
      type: 'app',
      beats: [
        { dur: 4.2, shot: 'pricing', focus: 'full', tag: N('1/7', '画面の全体'), caption: '月を選ぶと、その月の<em>着地予測</em>と<em>日別価格カレンダー</em>が並びます。' },
        { dur: 6.2, focus: 'landing', highlight: true, label: '着地予測', tag: N('2/7', '着地予測'), caption: 'いまの ADR・稼働率・REV-Per と、月末の<em>着地予測</em>を並べて表示。予算比もここで分かります。' },
        { dur: 6.4, focus: { region: 'calendarHead', maxZoom: 1.45 }, tag: N('3/7', '日別価格カレンダー'), caption: '1日1行。<em>予算・現在・推奨</em>の ADR と稼働率、推奨料金ランクを横に見比べます。' },
        { dur: 5.6, focus: { region: 'weekend', pad: 120, maxZoom: 1.5 }, highlight: 'weekend', label: '週末（金・土）', tag: N('3/7', '日別価格カレンダー'), caption: '日のタイプ（平日・週末・特日の型）と需要のアラート A〜E が、日ごとに付きます。' },
        { dur: 3.4, focus: { region: 'weekend', pad: 120, maxZoom: 1.5 }, cursor: 'row', cursorAt: [0.3, 0.5], click: true, tag: N('4/7', '日のAI分析'), caption: '気になる日の行をクリックすると…' },
        { dur: 5.4, dialog: 'pricing-day', focus: 'dialog', tag: N('4/7', '日のAI分析'), caption: 'その日だけを掘り下げる<em>「日のAI分析」</em>が開きます。' },
        { dur: 6.6, focus: 'dlg:daytype', highlight: true, label: '日のタイプと優先モデル', tag: N('4/7', '日のAI分析'), caption: '過去の結果から分けた<em>日のタイプ</em>と、稼働優先・バランス・単価優先のどれで見るか。90日前からの移り変わりも残ります。' },
        { dur: 5.8, focus: 'dlg:curve', highlight: true, label: 'ブッキングカーブ', tag: N('4/7', '日のAI分析'), caption: '予約の入り方を、前年同曜日・同じ型の日のカーブと重ねて確認。' },
        { dur: 5.6, focus: 'dlg:rec', highlight: true, label: '推奨価格と料金ランク', tag: N('5/7', '推奨'), caption: '推奨価格と料金ランク、稼働率の予測、競合の価格水準（中央値）をひと目で。' },
        { dur: 7.4, focus: 'dlg:sim', highlight: true, label: 'この日のシミュレーション', tag: N('6/7', 'シミュレーション'), caption: '優先モデルや料金ランクを変えると、稼働・売上・REV-Per がどう動くか。<em>保存せずに試算</em>できます。' },
        { dur: 4.8, dialog: null, shot: 'pricing-type', focus: { region: 'calendar', maxZoom: 1.3, pan: -120 }, highlight: 'typeSelect', label: 'タイプの切り替え', tag: N('7/7', '部屋タイプ別'), caption: '表は<em>部屋タイプ別</em>にも切り替えられます（既定は全タイプの合計）。' },
        { dur: 6.2, shot: 'pricing', focus: 'onhand', highlight: true, label: 'オンハンド状況', tag: N('7/7', 'オンハンド状況'), caption: '下には<em>オンハンド状況</em>。予約済みの室数と ADR を、予算と日ごとに重ねています。' },
      ],
    },
    {
      type: 'cards', dur: 8.4, kicker: 'まとめ', title: 'この画面でできること', cols: 3,
      items: [
        { t: '月の着地を先に知る', d: '着地予測の ADR・稼働率・REV-Per と予算比を、月の途中で確認。' },
        { t: '1日ずつ、根拠を見て決める', d: '日のタイプ・予約の入り方・競合の水準を1つのダイアログに。' },
        { t: '決める前に試算する', d: '優先モデルと料金ランクを変えて、稼働と売上の動きを比べる。' },
      ],
      foot: '※ 現在の推奨はルールベースの需要予測によるものです。サイトコントローラーの料金ランク表示と先の日の予約単価は、PMS／サイトコントローラー連携後に対応します。',
    },
  ],
}
