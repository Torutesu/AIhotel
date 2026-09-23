"use client"

// 需要構成・予約期間分析のサンプルデータ（U-15 で analysis-tab.tsx から分割）
//
// 予約明細のモデルが無いため、予約期間・セグメント・利用人数の数値は
// すべて画面確認用のサンプル。表示側は必ず SampleDataNotice を併記すること。

/** 対象期間に応じたサンプルデータ（予約期間/セグメント/利用人数）を生成する純粋関数。チャネル別・部屋タイプ別は実API（#88） */
export function buildPeriodData(targetPeriod: string) {
  const baseMultiplier =
    targetPeriod === "2025-03" ? 0.9 : targetPeriod === "2025-04" ? 1.0 : targetPeriod === "2025-05" ? 1.1 : 1.0

  return {
    bookingWindowData: [
      {
        window: "当日",
        bookings: Math.round(45 * baseMultiplier),
        share: 6.1,
        adr: Math.round(15200 * (0.95 + baseMultiplier * 0.05)),
        cancel: 2.2,
        growth: -3.5 * baseMultiplier,
      },
      {
        window: "1-3日前",
        bookings: Math.round(98 * baseMultiplier),
        share: 13.2,
        adr: Math.round(16800 * (0.95 + baseMultiplier * 0.05)),
        cancel: 3.8,
        growth: 5.2 * baseMultiplier,
      },
      {
        window: "4-7日前",
        bookings: Math.round(156 * baseMultiplier),
        share: 21.1,
        adr: Math.round(18200 * (0.95 + baseMultiplier * 0.05)),
        cancel: 4.5,
        growth: 8.7 * baseMultiplier,
      },
      {
        window: "8-14日前",
        bookings: Math.round(189 * baseMultiplier),
        share: 25.5,
        adr: Math.round(19100 * (0.95 + baseMultiplier * 0.05)),
        cancel: 5.2,
        growth: 12.3 * baseMultiplier,
      },
      {
        window: "15-30日前",
        bookings: Math.round(168 * baseMultiplier),
        share: 22.7,
        adr: Math.round(19800 * (0.95 + baseMultiplier * 0.05)),
        cancel: 6.8,
        growth: 15.8 * baseMultiplier,
      },
      {
        window: "31-60日前",
        bookings: Math.round(62 * baseMultiplier),
        share: 8.4,
        adr: Math.round(20500 * (0.95 + baseMultiplier * 0.05)),
        cancel: 8.5,
        growth: 18.2 * baseMultiplier,
      },
      {
        window: "61日以上前",
        bookings: Math.round(23 * baseMultiplier),
        share: 3.1,
        adr: Math.round(21200 * (0.95 + baseMultiplier * 0.05)),
        cancel: 12.1,
        growth: 22.5 * baseMultiplier,
      },
    ],
    segmentData: [
      {
        segment: "ビジネス",
        bookings: Math.round(312 * baseMultiplier),
        share: 42.1,
        adr: Math.round(16800 * (0.95 + baseMultiplier * 0.05)),
        nights: 1.2,
        ltv: Math.round(52800 * baseMultiplier),
      },
      {
        segment: "レジャー（個人）",
        bookings: Math.round(245 * baseMultiplier),
        share: 33.1,
        adr: Math.round(21200 * (0.95 + baseMultiplier * 0.05)),
        nights: 2.1,
        ltv: Math.round(93912 * baseMultiplier),
      },
      {
        segment: "レジャー（家族）",
        bookings: Math.round(98 * baseMultiplier),
        share: 13.2,
        adr: Math.round(24500 * (0.95 + baseMultiplier * 0.05)),
        nights: 2.8,
        ltv: Math.round(137200 * baseMultiplier),
      },
      {
        segment: "団体",
        bookings: Math.round(52 * baseMultiplier),
        share: 7.0,
        adr: Math.round(18900 * (0.95 + baseMultiplier * 0.05)),
        nights: 1.5,
        ltv: Math.round(56700 * baseMultiplier),
      },
      {
        segment: "VIP/リピーター",
        bookings: Math.round(34 * baseMultiplier),
        share: 4.6,
        adr: Math.round(28500 * (0.95 + baseMultiplier * 0.05)),
        nights: 2.5,
        ltv: Math.round(178500 * baseMultiplier),
      },
    ],
    guestCountData: [
      {
        guestCount: "1名",
        bookings: Math.round(312 * baseMultiplier),
        share: 42.1,
        adr: Math.round(16800 * (0.95 + baseMultiplier * 0.05)),
        nights: 1.2,
        ltv: Math.round(52800 * baseMultiplier),
        unitPrice: Math.round(16800 * (0.95 + baseMultiplier * 0.05)),
      },
      {
        guestCount: "2名",
        bookings: Math.round(245 * baseMultiplier),
        share: 33.1,
        adr: Math.round(21200 * (0.95 + baseMultiplier * 0.05)),
        nights: 2.1,
        ltv: Math.round(93912 * baseMultiplier),
        unitPrice: Math.round(21200 * (0.95 + baseMultiplier * 0.05) / 2),
      },
      {
        guestCount: "3名",
        bookings: Math.round(98 * baseMultiplier),
        share: 13.2,
        adr: Math.round(24500 * (0.95 + baseMultiplier * 0.05)),
        nights: 2.8,
        ltv: Math.round(137200 * baseMultiplier),
        unitPrice: Math.round(24500 * (0.95 + baseMultiplier * 0.05) / 3),
      },
      {
        guestCount: "4名以上",
        bookings: Math.round(52 * baseMultiplier),
        share: 7.0,
        adr: Math.round(18900 * (0.95 + baseMultiplier * 0.05)),
        nights: 1.5,
        ltv: Math.round(56700 * baseMultiplier),
        unitPrice: Math.round(18900 * (0.95 + baseMultiplier * 0.05) / 4),
      },
    ],
  }
}
