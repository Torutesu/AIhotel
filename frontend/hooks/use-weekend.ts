"use client"

// 週末判定の共通フック（U-6）
// 「週末＝金・土」等の曜日はコードにハードコードせず、必ず Hotel.weekendDays を参照する。
// AuthProvider が保持している hotel から解決し、未取得時のみ既定値（金・土）にフォールバックする。

import { useMemo } from "react"
import { useAuth } from "@/components/auth-provider"
import {
  DEFAULT_WEEKEND_DAYS,
  isWeekendDate,
  isWeekendDow,
  parseWeekendDays,
  weekendDaysLabel,
} from "@/lib/date"

export interface UseWeekendResult {
  /** 週末として扱う曜日番号（0=日〜6=土） */
  weekendDays: number[]
  /** 曜日番号が週末か */
  isWeekendDow: (dow: number) => boolean
  /** 日付が週末か */
  isWeekend: (date: Date) => boolean
  /** 「金・土」のような表示用ラベル */
  weekendLabel: string
  /** ホテル設定を取得できておらず既定値で動作しているか */
  isFallback: boolean
}

export function useWeekend(): UseWeekendResult {
  const { hotel } = useAuth()

  return useMemo(() => {
    const weekendDays = hotel ? parseWeekendDays(hotel.weekendDays) : DEFAULT_WEEKEND_DAYS
    return {
      weekendDays,
      isWeekendDow: (dow: number) => isWeekendDow(dow, weekendDays),
      isWeekend: (date: Date) => isWeekendDate(date, weekendDays),
      weekendLabel: weekendDaysLabel(weekendDays),
      isFallback: hotel == null,
    }
  }, [hotel])
}
