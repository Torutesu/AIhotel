import { describe, it, expect } from "vitest"
import { inviteFormSchema } from "./user-invite-dialog"

// 招待フォームの初期パスワード（#89）: 空欄は招待（一時パスワードの発行）、入力するなら backend と同じ強度

const base = { email: "new@example.com", name: "新人", role: "OPERATOR" as const, hotelId: "h1" }

describe("inviteFormSchema", () => {
  it("初期パスワードは空欄でもよい（一時パスワードを発行する）", () => {
    expect(inviteFormSchema.safeParse({ ...base, password: "" }).success).toBe(true)
  })

  it("入力するなら大文字・小文字・数字を含む8文字以上", () => {
    expect(inviteFormSchema.safeParse({ ...base, password: "Abcdefg1" }).success).toBe(true)
    expect(inviteFormSchema.safeParse({ ...base, password: "abcdefg1" }).success).toBe(false)
    expect(inviteFormSchema.safeParse({ ...base, password: "Abc1" }).success).toBe(false)
  })
})
