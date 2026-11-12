// ローンチ動画（約85秒）。課題 → 製品 → 4つの画面 → 土台 → ロゴ。
const S1 = { k: '01 — ダッシュボード', t: '見るべきことから、<br>先に。', d: '重要度の高いアラートと、当月・先々の見通し。開いた瞬間に、今日やることが分かります。' }
const S1b = { ...S1, d: '室料売上・ADR・稼働率・REV-Per。予算比・前年比と着地予測を、1つの表で。' }
const S2 = { k: '02 — ダイナミックプライシング', t: '1日ずつ、<br>根拠を見て決める。', d: '予算・いまの予約・推奨料金ランクを、日ごとに横並びで見比べます。' }
const S2b = { ...S2, d: '行を開けば、その日のタイプ・予約の入り方・競合の水準まで。' }
const S2c = { ...S2, d: 'ランクを変えたら、稼働と売上はどう動くか。決める前に試算できます。' }
const S3 = { k: '03 — 分析', t: '結果を、<br>次の判断に。', d: '日ごとに、実数・想定・予算を並べて差異を確認。' }
const S3b = { ...S3, d: 'どのチャネル・部屋タイプから売れたか。前年同月との比較も。' }
const S3c = { ...S3, d: '競合ホテルとの価格差を、日別・利用人数別に。' }
const S4 = { k: '04 — 外部需要・レポート', t: '外の動きも、<br>報告も。', d: 'イベントや周辺の新規ホテルを登録して、料金の判断材料に。' }
const S4b = { ...S4, d: '月次レポートは、PDF と Excel でそのまま出力。' }

export default {
  kicker: 'LAUNCH',
  title: 'レブスト',
  hideChip: true,
  poster: 16.5,
  clips: [
    {
      type: 'statement', dur: 5.2, align: 'center',
      lines: [{ text: '今日の料金、' }, { text: '<span class="accent">何を根拠</span>に決めましたか。', at: 0.75 }],
      narration: '今日の料金、何を根拠に決めましたか。',
    },
    {
      type: 'pains', dur: 8.2, kicker: 'ホテルの収益管理で、よくあること', gap: 1.15, strikeAt: 6.6,
      items: [
        { t: '数字がばらばら', d: '実績・予算・予約・競合価格が、別々の表とシステムに。' },
        { t: '値付けが属人的', d: '経験と勘が頼り。判断の根拠が残らない。' },
        { t: '気づくのが遅い', d: '予算未達が分かるのは、月が終わってから。' },
      ],
      narration: '実績、予算、予約、競合価格。数字はばらばらで、値付けは経験と勘が頼り。予算未達に気づくのは、月が終わってからでした。',
    },
    {
      type: 'logo', dur: 5.4, tagline: 'ホテルの収益管理を、ひとつの画面に。', small: 'AIレベニュー管理システム',
      narration: 'レブスト。ホテルの収益管理を、ひとつの画面に。',
    },
    {
      type: 'app',
      beats: [
        { dur: 0.1, shot: 'dashboard', focus: 'full', tilt: { rx: 10, ry: -16, z: 0.86 } },
        { dur: 5.6, focus: 'full', move: 2.6, caption: '予算・実績・予約・競合。毎日の判断材料を、ここに集めました。', narration: '予算、実績、予約、競合。毎日の判断材料を、ここに集めました。' },
        // 01 ダッシュボード
        { dur: 4.6, side: S1, focus: { region: 'alerts', maxZoom: 1.5 }, highlight: 'alert1', narration: 'ダッシュボードは、見るべきことから先に。重要度の高いアラートと、当月・先々の見通しが最初に並びます。' },
        { dur: 4.2, side: S1b, focus: { region: 'kpi', maxZoom: 1.6 }, highlight: 'kpi', narration: '売上、ADR、稼働率、REV-Per。予算比・前年比と着地予測を、1つの表で確認できます。' },
        { dur: 3.8, focus: { region: 'curve', maxZoom: 1.5 } },
        // 02 ダイナミックプライシング
        { dur: 4.8, shot: 'pricing', side: S2, focus: { region: 'calendarHead', maxZoom: 1.5 }, narration: 'ダイナミックプライシングでは、予算、いまの予約、推奨料金ランクを、日ごとに横並びで見比べます。' },
        { dur: 2.8, focus: { region: 'weekend', pad: 150, maxZoom: 1.5 }, highlight: 'weekend', cursor: 'row', cursorAt: [0.3, 0.5], click: true },
        { dur: 4.4, side: S2b, dialog: 'pricing-day', focus: { region: 'dlg:daytype', maxZoom: 1.5 }, narration: '行を開けば、その日のタイプ、予約の入り方、競合の水準まで。' },
        { dur: 3.6, focus: { region: 'dlg:rec', maxZoom: 1.9 }, highlight: 'dlg:rec' },
        { dur: 4.8, side: S2c, focus: { region: 'dlg:sim', maxZoom: 1.7 }, highlight: 'dlg:sim', narration: 'ランクを変えたら、稼働と売上はどう動くか。決める前に試算できます。' },
        // 03 分析
        { dur: 4, shot: 'analysis-trend', dialog: null, side: S3, focus: { region: 'daily', maxZoom: 1.5 }, narration: '分析では、日ごとの実数・想定・予算の差異から、' },
        { dur: 3.8, shot: 'analysis-mix', side: S3b, focus: { region: 'channel', maxZoom: 1.5 }, narration: 'チャネルや部屋タイプの構成、' },
        { dur: 3.8, shot: 'analysis-competitor', side: S3c, focus: { region: 'compare', maxZoom: 1.5 }, narration: '競合ホテルとの価格差まで。結果を、次の判断につなげます。' },
        // 04 外部需要・レポート
        { dur: 4, shot: 'external', side: S4, focus: { region: 'events', pad: 40, maxZoom: 1.5 }, highlight: 'events', narration: 'イベントや周辺の新規ホテルを登録して、料金の判断材料に。' },
        { dur: 4.6, shot: 'reports', side: S4b, focus: 'full', paper: true, narration: '月次レポートは、PDF と Excel でそのまま出力できます。' },
      ],
    },
    {
      type: 'cards', dur: 8.6, kicker: '安心して使える土台', title: 'チェーンでも、1館でも。', cols: 4, gap: 0.3,
      items: [
        { t: '会社ごとに<br>データを分離', d: 'マルチテナント設計。管理者でも、他社のデータは参照できません。' },
        { t: '役割に合わせた<br>権限', d: '管理者・マネージャー・オペレーターで、できる操作を分けます。' },
        { t: '変更は<br>すべて記録', d: '設定の変更は監査ログへ。誰がいつ変えたかを追えます。' },
        { t: 'CSV で<br>すぐ始める', d: '日次実績・予約数・予算を、CSV と Excel で取り込み。' },
      ],
      foot: 'PMS／サイトコントローラー／OTA との連携、機械学習による需要予測、AI コメントの自動生成は、順次対応予定です。',
      narration: '会社ごとのデータ分離、役割に合わせた権限、監査ログ。CSV の取り込みで、すぐに始められます。',
    },
    {
      type: 'logo', dur: 6.4, last: true, tagline: '収益の流れを、毎日の判断に。', small: '画面はデモ用ホテルのデータです',
      narration: 'レブスト。収益の流れを、毎日の判断に。',
    },
  ],
}
