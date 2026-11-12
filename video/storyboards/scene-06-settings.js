// シーン別の説明動画 06: 設定
const N = (n, t) => `<b>${n}</b>${t}`

export default {
  kicker: 'SCENE 06',
  title: '設定',
  clips: [
    {
      type: 'title', dur: 4.6, num: '06', kicker: 'SCENE 06',
      title: '設定',
      sub: 'ホテルごとの前提をそろえる場所。週末の定義から料金ランク、価格戦略、ユーザーと監査ログまで。',
      points: ['ホテル情報', '料金ランク', '価格戦略', '予算', 'CSV 取り込み', 'ユーザー・監査ログ'],
    },
    {
      type: 'app',
      beats: [
        { dur: 4.6, shot: 'settings', focus: 'full', tag: N('1/10', 'ホテル情報'), caption: '設定は上から、ホテル → 料金 → 価格戦略 → データ → ユーザーの順に並んでいます。' },
        { dur: 5.6, focus: { region: 'weekend', pad: 150 }, highlight: 'weekend', label: '週末定義', tag: N('1/10', 'ホテル情報'), caption: '<em>週末の定義</em>はホテルごとに。既定は金・土で、変更は集計と強調表示にすぐ反映されます。' },
        { dur: 5.4, focus: 'setup', highlight: true, label: '初期設定の一括投入', tag: N('2/10', '初期設定'), caption: '新しいホテルの設定は、<em>Excel の初期設定シート</em>でまとめて入れられます。' },
        { dur: 5.8, focus: 'ranks', highlight: true, label: '料金ランク（最大40段階）', tag: N('3/10', '料金ランク'), caption: '<em>料金ランクは最大40段階</em>。ランクごとに、人数別の料金を登録します。' },
        { dur: 6.6, focus: 'weights', highlight: true, label: '合計100%', tag: N('4/10', '価格戦略の重み付け'), caption: '<em>価格戦略の重み付け</em>。稼働率・ADR・競合の3つを、合計100%になるように配分します。' },
        { dur: 6.2, focus: { region: 'adjust', maxZoom: 1.3 }, highlight: 'adjust', label: '推奨の調整', tag: N('5/10', '推奨の調整'), caption: '推奨ランクの下限・上限、1回の変動幅、期間・曜日ごとの<em>価格の幅</em>を決められます。' },
        { dur: 5.8, focus: 'budget', highlight: true, label: '予算', tag: N('6/10', '予算'), caption: '<em>予算</em>は年単位で12か月ぶん。前年実績も同じ表で登録できます。' },
        { dur: 6, focus: { region: 'importDaily', pad: 110 }, highlight: 'importDaily', label: 'CSV 取り込み', tag: N('7/10', 'データの取り込み'), caption: 'PMS 連携までは、<em>日次実績と予約数（OTB）を CSV</em> で取り込みます。テンプレートも用意しています。' },
        { dur: 5.2, focus: 'competitors', highlight: true, label: '競合ホテル（5社まで）', tag: N('8/10', '競合ホテル'), caption: '比較の対象にする<em>競合ホテル</em>は5社まで登録できます。' },
        { dur: 6, focus: 'users', highlight: true, label: 'ユーザー管理', tag: N('9/10', 'ユーザーと権限'), caption: 'ユーザーのロールは<em>管理者・マネージャー・オペレーター</em>。できる操作を役割で分けます。' },
        { dur: 5.8, focus: 'audit', highlight: true, label: '監査ログ', tag: N('10/10', '監査ログとセキュリティ'), caption: '設定の変更やログインは<em>監査ログ</em>に記録。誰がいつ操作したかを追えます。' },
        { dur: 5.4, focus: { region: 'ip', pad: 60 }, highlight: 'ip', label: 'IP アドレス制限', tag: N('10/10', '監査ログとセキュリティ'), caption: '接続元を絞る<em>IP アドレス制限</em>や、全端末からのログアウトも用意しています。' },
      ],
    },
    {
      type: 'cards', dur: 8.2, kicker: 'まとめ', title: 'この画面でできること', cols: 3,
      items: [
        { t: 'ホテルの前提をそろえる', d: '週末定義・部屋タイプ・料金ランク・予算をホテル単位で。' },
        { t: '推奨の出し方を決める', d: '重み付けは合計100%。価格の幅と変動幅も設定できます。' },
        { t: '安全に運用する', d: 'ロールによる権限、監査ログ、IP アドレス制限。' },
      ],
      foot: '※ 設定を変更できるのは管理者とマネージャーです。会社（テナント）をまたいだ参照は、運営以外にはできません。',
    },
  ],
}
