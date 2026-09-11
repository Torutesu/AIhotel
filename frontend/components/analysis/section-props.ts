"use client"

// 分析セクション共通の型とフック（U-15 で analysis-tab.tsx から分割）

import { useCallback } from "react"
import { usePeriod } from "@/components/app-state-provider"

/**
 * 各分析セクション共通のprops。
 * targetPeriod が渡されない場合は全タブ共有の対象年月（URL同期）で動作する。
 */
export interface AnalysisSectionProps {
  targetPeriod?: string
  onTargetPeriodChange?: (value: string) => void
}

/**
 * 対象期間の解決。props で渡されなければ全タブ共有の対象年月（URL同期）を使う。
 * 年月をコンポーネント内に固定値で持たない（U-8）。
 */
export function useTargetPeriod({ targetPeriod, onTargetPeriodChange }: AnalysisSectionProps) {
  const { periodMonth, setPeriodMonth } = usePeriod()
  const period = targetPeriod ?? periodMonth
  const setPeriod = useCallback(
    (value: string) => {
      if (onTargetPeriodChange) onTargetPeriodChange(value)
      else setPeriodMonth(value)
    },
    [onTargetPeriodChange, setPeriodMonth],
  )
  return { targetPeriod: period, setTargetPeriod: setPeriod }
}
