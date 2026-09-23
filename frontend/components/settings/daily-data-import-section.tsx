"use client"

// 実績データの取り込み（#82 / POST /imports/daily-data）。PMS 連携（Phase 4）までのつなぎ。

import { CsvImportCard } from "@/components/settings/csv-import-card"
import { useAuth } from "@/components/auth-provider"
import { api } from "@/lib/api"
import { DAILY_DATA_CSV_TEMPLATE, parseDailyDataCsv } from "@/lib/daily-data-csv"

export function DailyDataImportSection() {
  const { hotel } = useAuth()
  return (
    <CsvImportCard
      title="実績データの取り込み"
      description={
        <>
          日別の販売室数・室料売上・宿泊人数を CSV で取り込みます（PMS 連携までの手段）。
          稼働率・ADR・RevPAR は客室数{hotel ? `（${hotel.totalRooms.toLocaleString()}室）` : ""}から自動で計算します。
          同じ日付の実績は上書きされます。
        </>
      }
      templateFileName="日次実績テンプレート.csv"
      template={DAILY_DATA_CSV_TEMPLATE}
      maxRows={1000}
      parse={parseDailyDataCsv}
      submit={(hotelId, rows, dryRun) => api.importDailyData(hotelId, rows, dryRun)}
    />
  )
}
