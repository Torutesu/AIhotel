"use client"

// 競合価格（#9）と OTB（#24 E2）の CSV 取り込み。
// どちらも提供側の自動取り込み（自前の取得・毎日の OTB）が同じ API に書き込む。画面からの取り込みは手動の補完用。
// 過去の予約の推移（ブッキングカーブ — D-13）は導入時に1回入れる想定の一括取り込み。
// 予約明細から作る方法（推奨）と、推移そのもの（宿泊日×残日数×室数）を入れる方法の2つがある。

import { useState } from "react"

import { CsvImportCard } from "@/components/settings/csv-import-card"
import { LabeledMonthPicker } from "@/components/month-picker"
import { api } from "@/lib/api"
import { daysInMonth, parseMonthStr, toMonthStr } from "@/lib/date"
import {
  BOOKING_CURVE_CSV_TEMPLATE,
  COMPETITOR_PRICE_CSV_TEMPLATE,
  OTB_CSV_TEMPLATE,
  RESERVATION_CSV_TEMPLATE,
  parseBookingCurveCsv,
  parseCompetitorPriceCsv,
  parseOtbCsv,
  parseReservationCsv,
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

export function BookingCurveImportSection() {
  return (
    <CsvImportCard
      title="過去の予約積上（ブッキングカーブ）の取り込み"
      description={
        <>
          導入時に過去の予約の推移を入れると、ピックアップ型・前年ペース・似た日の予測がすぐ働きます。
          1行に、宿泊日・その時点（残日数＝宿泊日の何日前、または取得日のどちらか）・その時点の予約室数を書きます。
          PMS・サイトコントローラーから出せる形に合わせてください。同じ宿泊日・同じ時点の行は上書きされます。
        </>
      }
      templateFileName="予約積上テンプレート.csv"
      template={BOOKING_CURVE_CSV_TEMPLATE}
      maxRows={5000}
      parse={parseBookingCurveCsv}
      submit={(hotelId, rows, dryRun) => api.importBookingCurve(hotelId, rows, dryRun)}
    />
  )
}

/** 宿泊月（YYYY-MM）の初日と末日 */
export function stayRangeOf(monthStr: string): { stayFrom: string; stayTo: string } {
  const { year, month } = parseMonthStr(monthStr)
  const mm = String(month).padStart(2, "0")
  return { stayFrom: `${year}-${mm}-01`, stayTo: `${year}-${mm}-${String(daysInMonth(year, month)).padStart(2, "0")}` }
}

/** 前月（予約明細から作るときの既定の対象月） */
function previousMonthStr(): string {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
  return toMonthStr(d)
}

export function ReservationImportSection() {
  const [monthStr, setMonthStr] = useState(previousMonthStr)
  const { stayFrom, stayTo } = stayRangeOf(monthStr)
  return (
    <CsvImportCard
      // 対象月を変えたら、前の月で確認した内容を捨てる
      key={monthStr}
      title="予約明細から作る（推奨）"
      description={
        <div className="space-y-2">
          <p>
            PMS・サイトコントローラーの予約明細（2年分が目安）から、どの残日数の時点で何室入っていたかを作ります。対象の月の泊にかかる予約をすべて含めてください。
            取消日のある予約は、取り消すまでの時点だけに数えます。宿泊月ごとに1つずつ取り込みます（前月から泊まり続ける予約も含めます）。
          </p>
          <LabeledMonthPicker id="reservation-import-month" label="対象の宿泊月" value={monthStr} onChange={setMonthStr} yearOffsets={[-3, -2, -1, 0]} />
        </div>
      }
      templateFileName="予約明細テンプレート.csv"
      template={RESERVATION_CSV_TEMPLATE}
      maxRows={10000}
      parse={parseReservationCsv}
      submit={(hotelId, rows, dryRun) => api.importReservations(hotelId, stayFrom, stayTo, rows, dryRun)}
      describe={(summary, phase) =>
        `${phase === "preview" ? "作る予約の推移" : "取り込んだ予約の推移"}（宿泊日×残日数）: 新規 ${summary.created}件・${phase === "preview" ? "既存のデータを上書き" : "更新"} ${summary.updated}件`
      }
    />
  )
}
