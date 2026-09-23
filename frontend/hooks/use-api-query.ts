"use client"

// API 取得の共通フック（#91）。
//
// 各コンポーネントが useEffect の中で個別に fetch していたため、ホテルや年月を素早く
// 切り替えると、遅れて返ってきた前の条件のレスポンスが新しい表示を上書きしうた
// （予算の画面では、前のホテルの予算を表示したまま今のホテルへ保存できた）。
// 取得ごとに世代番号を振り、最新の世代の結果だけを state に入れる。

import { useCallback, useEffect, useRef, useState, type DependencyList, type Dispatch, type SetStateAction } from "react"

import { ApiClientError } from "@/lib/api"

export interface ApiQuery<T> {
  data: T | null
  loading: boolean
  error: string | null
  /** 同じ条件で取り直す（エラー時の再試行・保存後の再読込） */
  reload: () => Promise<void>
  /** 保存 API の戻り値などで手元の値を差し替える */
  setData: Dispatch<SetStateAction<T | null>>
}

/**
 * @param fetcher 取得処理。null を渡すと取得しない（hotelId がまだ無いときなど）
 * @param deps fetcher が依存する値。変わったら前の取得結果を捨てて取り直す
 * @param errorMessage ApiClientError 以外で失敗したときの表示文言
 */
export function useApiQuery<T>(
  fetcher: (() => Promise<T>) | null,
  deps: DependencyList,
  errorMessage = "データの取得に失敗しました",
): ApiQuery<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(fetcher !== null)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const run = useCallback(async () => {
    const current = ++generation.current
    const fetch = fetcherRef.current
    if (!fetch) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await fetch()
      if (current === generation.current) setData(result)
    } catch (err) {
      if (current === generation.current) {
        setError(err instanceof ApiClientError && err.message ? err.message : errorMessage)
      }
    } finally {
      if (current === generation.current) setLoading(false)
    }
  }, [errorMessage])

  useEffect(() => {
    // 条件が変わったら、前の条件の値を見せ続けない
    setData(null)
    void run()
    // 世代番号は DOM ではなく取得の順番を数える値なので、クリーンアップ時点の値を使ってよい
    const counter = generation
    return () => {
      // アンマウント・条件変更後に返ってきた結果を捨てる
      counter.current++
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 依存は呼び出し側が deps で渡す
  }, deps)

  return { data, loading, error, reload: run, setData }
}
