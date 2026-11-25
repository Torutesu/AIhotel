// Fixed demo guidance: never present invented values or unavailable features as facts.
export function mockChatReply(query: string): string {
  const q = query.toLowerCase()
  const notice = "デモ用の回答例です。実際のホテルデータを分析した結果ではありません。\n\n"
  if (q.includes("レポート") || q.includes("report")) {
    return notice + "レポート画面では月次レポートの対象年月を選べます。PDF・Excelの出力には実APIへの接続が必要で、現在の公開デモでは出力できません。四半期レポート・CSV出力・自動配信は提供していません。"
  }
  if (q.includes("稼働率") || q.includes("occupancy")) return notice + "稼働率は、販売した客室数を販売可能な客室数で割った割合です。ダッシュボードで予算・前年との差を、分析画面で日別の変化を確認できます。デモの数値はサンプルです。"
  if (q.includes("adr") || q.includes("平均客室単価")) return notice + "ADRは、室料売上を販売客室数で割った平均客室単価です。ダッシュボードや分析画面で稼働率とあわせて確認してください。"
  if (q.includes("料金") || q.includes("価格") || q.includes("プライシング")) return notice + "料金設定画面では、日別の需要予測や推奨料金を確認できます。実際の料金判断には予約状況・予算・競合価格を照合してください。このチャットから料金は変更されません。"
  if (q.includes("予約") || q.includes("チャネル")) return notice + "分析画面で予約の積み上がりや日別の傾向を確認できます。PMS・OTAの自動連携は現在のデモには接続していません。実データの分析には取り込み・接続が必要です。"
  if (q.includes("収益") || q.includes("売上") || q.includes("予算") || q.includes("revenue")) return notice + "ダッシュボードで室料売上・稼働率・ADRと予算との差を確認できます。表示されているデモの数値から、実際の収益改善効果を判断することはできません。"
  if (q.includes("予測") || q.includes("需要") || q.includes("来月")) return notice + "料金設定画面と外部需要動向画面で、需要予測やイベント情報の表示例を確認できます。この固定回答は実際の将来需要を予測したものではありません。"
  return notice + "ダッシュボード、料金設定、分析、月次レポートの使い方を確認できます。確認したい画面や指標を教えてください。"
}
