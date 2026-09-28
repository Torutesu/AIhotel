import { describe, it, expect } from "vitest"

import type { TrialSummary } from "@shared/types"
import { parseDays, parseTrialCommand } from "./trial-command"

// トライアル管理の「文章で指示」

function trial(name: string, id = name): TrialSummary {
  return {
    id,
    name,
    kind: "DEALER",
    note: null,
    status: "ACTIVE",
    expiresAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
    daysLeft: 10,
    purgeAt: null,
    loginEmail: `trial-${id}@trial.example.com`,
    lastLoginAt: null,
    createdAt: new Date().toISOString(),
  }
}

describe("parseDays", () => {
  it("日・週・か月と漢数字・全角数字を読む", () => {
    expect(parseDays("30日")).toBe(30)
    expect(parseDays("2週間")).toBe(14)
    expect(parseDays("1ヶ月")).toBe(30)
    expect(parseDays("三か月".normalize("NFKC"))).toBe(90)
    expect(parseDays("十五日")).toBe(15)
    expect(parseDays("２０日".normalize("NFKC"))).toBe(20)
    expect(parseDays("延長して")).toBeNull()
  })
})

describe("parseTrialCommand", () => {
  const trials = [trial("○○販売店", "a"), trial("△△ホテル", "b"), trial("△△ホテル別館", "c")]

  it.each([
    ["○○商事に30日のIDを発行", { name: "○○商事", kind: "PROSPECT_HOTEL", days: 30 }],
    ["山田販売店用のトライアルを2週間で作って", { name: "山田販売店", kind: "DEALER", days: 14 }],
    ["グランドホテル東京さん向けに１ヶ月のアカウントをお願いします", { name: "グランドホテル東京", kind: "PROSPECT_HOTEL", days: 30 }],
    ["「にしき旅館」に発行", { name: "にしき旅館", kind: "PROSPECT_HOTEL", days: 30 }],
    ["ABC代理店 発行", { name: "ABC代理店", kind: "DEALER", days: 30 }],
  ])("新規発行: %s", (text, expected) => {
    const result = parseTrialCommand(text, trials)
    expect(result.ok && result.command).toEqual({ type: "create", ...expected })
  })

  it("一覧にある渡し先への操作を読み取る（長い名前を優先）", () => {
    const pick = (text: string) => {
      const result = parseTrialCommand(text, trials)
      if (!result.ok) throw new Error(result.message)
      const { command } = result
      return { type: command.type, id: "trial" in command ? command.trial.id : null, days: "days" in command ? command.days : undefined }
    }
    expect(pick("○○販売店を2週間延長して")).toEqual({ type: "extend", id: "a", days: 14 })
    expect(pick("△△ホテル別館を停止")).toEqual({ type: "suspend", id: "c", days: undefined })
    expect(pick("△△ホテルの停止を解除")).toEqual({ type: "resume", id: "b", days: undefined })
    expect(pick("○○販売店のパスワードを再発行")).toEqual({ type: "reset", id: "a", days: undefined })
    expect(pick("△△ホテルを削除")).toEqual({ type: "delete", id: "b", days: undefined })
  })

  it("読み取れない・範囲外は理由を返す", () => {
    expect(parseTrialCommand("", trials)).toMatchObject({ ok: false })
    expect(parseTrialCommand("○○販売店を延長", trials)).toMatchObject({ ok: false, message: expect.stringContaining("何日延長") })
    expect(parseTrialCommand("××商事を停止", trials)).toMatchObject({ ok: false, message: expect.stringContaining("見つかりません") })
    expect(parseTrialCommand("○○商事に100日で発行", trials)).toMatchObject({ ok: false, message: expect.stringContaining("90日") })
  })
})
