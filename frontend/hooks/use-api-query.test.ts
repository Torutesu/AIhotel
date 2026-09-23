import { describe, it, expect } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"

import { useApiQuery } from "@/hooks/use-api-query"
import { ApiClientError } from "@/lib/api"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe("useApiQuery（#91）", () => {
  it("条件を切り替えた後に前の条件のレスポンスが返ってきても、新しい表示を上書きしない", async () => {
    const pending: Record<string, ReturnType<typeof deferred<string>>> = {
      A: deferred<string>(),
      B: deferred<string>(),
    }
    const { result, rerender } = renderHook(({ hotel }) => useApiQuery(() => pending[hotel].promise, [hotel]), {
      initialProps: { hotel: "A" },
    })

    rerender({ hotel: "B" })
    await act(async () => {
      pending.B.resolve("Bの予算")
    })
    await waitFor(() => expect(result.current.data).toBe("Bの予算"))

    // 遅れて A が返ってくる
    await act(async () => {
      pending.A.resolve("Aの予算")
    })
    expect(result.current.data).toBe("Bの予算")
    expect(result.current.loading).toBe(false)
  })

  it("条件が変わったら、取得が終わるまで前の値を見せない", async () => {
    const pending = deferred<string>()
    const { result, rerender } = renderHook(
      ({ hotel }) => useApiQuery(() => (hotel === "A" ? Promise.resolve("A") : pending.promise), [hotel]),
      { initialProps: { hotel: "A" } },
    )
    await waitFor(() => expect(result.current.data).toBe("A"))
    rerender({ hotel: "B" })
    expect(result.current.data).toBeNull()
    expect(result.current.loading).toBe(true)
  })

  it("エラーは ApiClientError の文言、それ以外は既定の文言にし、reload で取り直せる", async () => {
    let attempt = 0
    const { result } = renderHook(() =>
      useApiQuery(
        () => {
          attempt++
          return attempt === 1 ? Promise.reject(new ApiClientError(500, "サーバーが混雑しています")) : Promise.resolve(1)
        },
        [],
        "既定の文言",
      ),
    )
    await waitFor(() => expect(result.current.error).toBe("サーバーが混雑しています"))
    await act(async () => {
      await result.current.reload()
    })
    expect(result.current.data).toBe(1)
    expect(result.current.error).toBeNull()
  })

  it("fetcher が null なら取得しない", () => {
    const { result } = renderHook(() => useApiQuery<number>(null, []))
    expect(result.current.loading).toBe(false)
    expect(result.current.data).toBeNull()
  })
})
