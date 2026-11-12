import { describe, it, expect } from "vitest"

import { stayRangeOf } from "@/components/settings/external-data-import-sections"

describe("stayRangeOf（予約明細から作る — D-13）", () => {
  it("対象の宿泊月の初日と末日を stayFrom / stayTo にする（うるう年の2月も）", () => {
    expect(stayRangeOf("2025-10")).toEqual({ stayFrom: "2025-10-01", stayTo: "2025-10-31" })
    expect(stayRangeOf("2024-02")).toEqual({ stayFrom: "2024-02-01", stayTo: "2024-02-29" })
  })
})
