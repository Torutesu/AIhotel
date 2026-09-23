"use client"

// 競合価格（#9）と OTB（#24 E2）の CSV 取り込み。
// どちらも提供側の自動取り込み（自前の取得・毎日の OTB）が同じ API に書き込む。画面からの取り込みは手動の補完用。

import { CsvImportCard } from "@/components/settings/csv-import-card"
import { api } from "@/lib/api"
import {
  COMPETITOR_PRICE_CSV_TEMPLATE,
  OTB_CSV_TEMPLATE,
  parseCompetitorPriceCsv,
  parseOtbCsv,
} from "@/lib/import-csv"

export function CompetitorPriceImportSection() {
  return (
    <CsvImportCard
      title="競合価格の取り込み"
      description={
        <>
          競合ホテルの宿泊日ごとの料金（素泊まり・税込・1室あたり、人数ごとの最安プラン）を CSV で取り込みます。
          競合ホテル名は下の「競合ホテル」に登録した名前と一致させてください。
          同じ競合・同じ日に取得元が複数あれば、人数ごとの最安値を使います。取得から48時間を過ぎた料金は推奨に使いません。
        </>
      }
      templateFileName="競合価格テンプレート.csv"
      template={COMPETITOR_PRICE_CSV_TEMPLATE}
      maxRows={5000}
      parse={parseCompetitorPriceCsv}
      submit={(hotelId, rows, dryRun) => api.importCompetitorPrices(hotelId, rows, dryRun)}
      unit="件"
    />
  )
}

export function OtbImportSection() {
  return (
    <CsvImportCard
      title="予約数（OTB）の取り込み"
      description={
        <>
          今日時点の、先の宿泊日ごとの予約室数を CSV で取り込みます。予約の積み上がり（ブッキングカーブ）は後から作れないため、
          毎日1回取り込みます（通常は自動で取り込まれます）。同じ日に取り込み直すと上書きされます。
        </>
      }
      templateFileName="予約数テンプレート.csv"
      template={OTB_CSV_TEMPLATE}
      maxRows={1000}
      parse={parseOtbCsv}
      submit={(hotelId, rows, dryRun) => api.importOtb(hotelId, rows, dryRun)}
    />
  )
}
