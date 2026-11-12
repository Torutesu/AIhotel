// デモモード用の AI チャットの答え（NEXT_PUBLIC_DEMO_MODE=true でバックエンドに接続できないときだけ使われる）。
// 本番は POST /api/v1/chat が Claude API でホテルのデータから答える（D-13）。ここの数字はすべてサンプル

export function mockChatReply(query: string): string {
  const lowerQuery = query.toLowerCase()

  if (lowerQuery.includes("稼働率") || lowerQuery.includes("occupancy")) {
    return "現在の稼働率は82.5%です。前月比-2.1%とやや低下していますが、週末は95%以上を維持しています。平日の稼働率向上のため、ビジネス客向けプロモーションの実施を推奨します。"
  }

  if (lowerQuery.includes("adr") || lowerQuery.includes("平均客室単価")) {
    return "現在のADRは¥18,250です。前年同月比+3.2%と好調に推移しています。競合の価格水準（中央値）が¥17,800であることを考慮すると、さらに5-8%の値上げ余地があると分析しています。"
  }

  if (lowerQuery.includes("価格") || lowerQuery.includes("プライシング") || lowerQuery.includes("料金")) {
    return "ダイナミックプライシング分析によると、4月5日（土）は需要が非常に高いため、現在価格¥24,000から¥26,500への値上げを推奨します。これにより約10.4%の増収が見込まれます。"
  }

  if (lowerQuery.includes("チャネル") || lowerQuery.includes("予約")) {
    return "公式サイトが全体の38.5%を占め、最も重要な予約チャネルとなっています。公式アプリの成長率が+24.8%と突出しており、モバイル戦略の強化が効果を発揮しています。"
  }

  if (lowerQuery.includes("収益") || lowerQuery.includes("売上") || lowerQuery.includes("revenue")) {
    return "今月の室料売上は¥12,450,000で、予算比+8.5%、前年比+12.3%と好調です。ADRの上昇が主な要因で、価格戦略が効果的に機能しています。"
  }

  if (lowerQuery.includes("レポート") || lowerQuery.includes("report")) {
    return "レポートタブから月次レポート、四半期レポート、カスタムレポートを生成できます。PDF、Excel、CSV形式でのエクスポートに対応しています。定期レポートの自動配信設定も可能です。"
  }

  if (lowerQuery.includes("予測") || lowerQuery.includes("forecast")) {
    return "AI予測によると、来月の稼働率は87.0%、ADRは¥18,333、室料売上は¥13,200,000に達する見込みです。地域イベントの開催により需要増加が期待されます。"
  }

  return "ご質問ありがとうございます。ダッシュボード、価格設定、日別分析、各種分析、レポートなど、システムの各機能についてサポートいたします。具体的にどのような情報をお探しですか？"
}
