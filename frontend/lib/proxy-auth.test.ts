import { describe, expect, it } from "vitest"

import { PROXY_AUTH_HEADER, applyProxyAuth } from "./proxy-auth"

describe("applyProxyAuth（R-2-3）", () => {
  it("秘密の値を付ける", () => {
    const headers = new Headers({ "content-type": "application/json" })
    applyProxyAuth(headers, "shared-secret")
    expect(headers.get(PROXY_AUTH_HEADER)).toBe("shared-secret")
  })

  it("クライアントが送ってきた同名のヘッダーは中継の値で置き換える", () => {
    const headers = new Headers({ [PROXY_AUTH_HEADER]: "forged" })
    applyProxyAuth(headers, "shared-secret")
    expect(headers.get(PROXY_AUTH_HEADER)).toBe("shared-secret")
  })

  it("秘密の値が未設定なら、クライアントの値も含めてヘッダーを付けない", () => {
    const headers = new Headers({ [PROXY_AUTH_HEADER]: "forged" })
    applyProxyAuth(headers, undefined)
    expect(headers.has(PROXY_AUTH_HEADER)).toBe(false)
  })
})
