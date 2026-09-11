import { describe, it, expect } from "vitest"

import {
  average,
  createSeededRandom,
  formatGuests,
  formatPercent,
  formatPt,
  formatRatio,
  formatRooms,
  formatSignedPt,
  formatSignedYen,
  formatYen,
  isRatioNegative,
} from "./format"

describe("formatYen", () => {
  it("3桁区切りの円表記にする", () => {
    expect(formatYen(21225)).toBe("¥21,225")
    expect(formatYen(0)).toBe("¥0")
  })

  it("小数は四捨五入する", () => {
    expect(formatYen(21225.4)).toBe("¥21,225")
    expect(formatYen(21225.5)).toBe("¥21,226")
  })

  it("null / undefined / NaN は「-」（0 と区別する）", () => {
    expect(formatYen(null)).toBe("-")
    expect(formatYen(undefined)).toBe("-")
    expect(formatYen(Number.NaN)).toBe("-")
  })
})

describe("formatSignedYen（競合比較の価格差 — #57）", () => {
  it("負の差額にマイナス記号を付ける（色だけに頼らない）", () => {
    // 自館 ¥21,225 / 競合 ¥24,200 → 自館のほうが ¥2,975 安い
    expect(formatSignedYen(21225 - 24200)).toBe("-¥2,975")
  })

  it("正の差額にはプラス記号を付ける（＋＝自館のほうが高い）", () => {
    expect(formatSignedYen(24200 - 21225)).toBe("+¥2,975")
  })

  it("0 は「+¥0」（符号なしの裸の数字にしない）", () => {
    expect(formatSignedYen(0)).toBe("+¥0")
  })

  it("符号を落として絶対値だけを返さない（#57 の回帰テスト）", () => {
    const formatted = formatSignedYen(-2975)
    expect(formatted).not.toBe("¥2,975")
    expect(formatted.startsWith("-")).toBe(true)
  })

  it("小数は四捨五入し、3桁区切りにする", () => {
    expect(formatSignedYen(-1234.6)).toBe("-¥1,235")
  })

  it("値なしは「-」", () => {
    expect(formatSignedYen(null)).toBe("-")
    expect(formatSignedYen(undefined)).toBe("-")
    expect(formatSignedYen(Number.NaN)).toBe("-")
  })
})

describe("formatPercent", () => {
  it("0〜1 の比率をパーセントにする（既定は小数第1位）", () => {
    expect(formatPercent(0.821)).toBe("82.1%")
    expect(formatPercent(1)).toBe("100.0%")
  })

  it("桁数を指定できる", () => {
    expect(formatPercent(0.8215, 2)).toBe("82.15%")
    expect(formatPercent(0.8215, 0)).toBe("82%")
  })

  it("値なしは「-」", () => {
    expect(formatPercent(null)).toBe("-")
    expect(formatPercent(undefined)).toBe("-")
  })
})

describe("formatSignedPt / formatPt", () => {
  it("比率の差はポイント表記で符号を付ける", () => {
    expect(formatSignedPt(0.032)).toBe("+3.2pt")
    expect(formatSignedPt(-0.032)).toBe("-3.2pt")
  })

  it("すでにパーセント値の数値は符号付きの % 表記にする", () => {
    expect(formatPt(12.34)).toBe("+12.3%")
    expect(formatPt(-12.34)).toBe("-12.3%")
  })

  it("値なしは「-」", () => {
    expect(formatSignedPt(null)).toBe("-")
    expect(formatPt(undefined)).toBe("-")
  })
})

describe("formatRooms / formatGuests", () => {
  it("単位付きの3桁区切りにする", () => {
    expect(formatRooms(1234)).toBe("1,234室")
    expect(formatGuests(1234)).toBe("1,234人")
  })

  it("値なしは「-」", () => {
    expect(formatRooms(null)).toBe("-")
    expect(formatGuests(null)).toBe("-")
  })
})

describe("formatRatio / isRatioNegative", () => {
  it("実績 ÷ 目標 を百分率で返す", () => {
    expect(formatRatio(950, 1000)).toBe("95.0%")
    expect(formatRatio(1050, 1000)).toBe("105.0%")
  })

  it("目標が 0 / null ならゼロ除算せず「-」", () => {
    expect(formatRatio(950, 0)).toBe("-")
    expect(formatRatio(950, null)).toBe("-")
    expect(formatRatio(null, 1000)).toBe("-")
  })

  it("達成率 95% 未満を警告扱いにする", () => {
    expect(isRatioNegative(949, 1000)).toBe(true)
    expect(isRatioNegative(950, 1000)).toBe(false)
    expect(isRatioNegative(950, 0)).toBe(false)
    expect(isRatioNegative(null, 1000)).toBe(false)
  })
})

describe("average", () => {
  it("null / undefined / NaN を除いた平均を返す", () => {
    expect(average([10, null, 20, undefined, Number.NaN])).toBe(15)
  })

  it("有効値が無ければ null（0 を返さない）", () => {
    expect(average([null, undefined])).toBeNull()
    expect(average([])).toBeNull()
  })
})

describe("createSeededRandom", () => {
  it("同じシードなら同じ系列を返す（サンプル表示の決定性）", () => {
    const a = createSeededRandom(42)
    const b = createSeededRandom(42)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })

  it("0 以上 1 未満を返す", () => {
    const rng = createSeededRandom(7)
    for (let i = 0; i < 50; i++) {
      const value = rng()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })
})
