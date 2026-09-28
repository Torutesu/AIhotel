import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { DemoTrialError } from "../core"

function credentialsKey(): Buffer {
  const key = process.env.DEMO_TRIAL_CREDENTIALS_KEY ?? ""
  if (!/^[a-f0-9]{64}$/i.test(key)) {
    throw new DemoTrialError(503, "ログイン情報の暗号化設定が完了していません。運営担当者にお問い合わせください")
  }
  return Buffer.from(key, "hex")
}

export function encryptTrialPassword(id: string, password: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", credentialsKey(), iv)
  cipher.setAAD(Buffer.from(id))
  const data = Buffer.concat([cipher.update(password, "utf8"), cipher.final()])
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".")
}

export function decryptTrialPassword(id: string, encrypted: string): string {
  const key = credentialsKey()
  try {
    const [version, iv, tag, data, extra] = encrypted.split(".")
    if (version !== "v1" || !iv || !tag || !data || extra !== undefined) throw new Error("invalid ciphertext")
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"))
    decipher.setAAD(Buffer.from(id))
    decipher.setAuthTag(Buffer.from(tag, "base64url"))
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8")
  } catch {
    throw new DemoTrialError(503, "パスワードを再表示できません。暗号化設定を確認してください")
  }
}

/** 運営の origin を配布先として使わない。URL にパスワードやメールアドレスを載せない */
export function trialLoginUrl(id: string): string {
  let url: URL
  try {
    url = new URL(process.env.DEMO_PUBLIC_URL ?? "")
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("invalid URL")
  } catch {
    throw new DemoTrialError(503, "配布用 URL が設定されていません。運営担当者にお問い合わせください")
  }
  url.pathname = "/"
  url.search = ""
  url.hash = ""
  url.searchParams.set("trial", id)
  return url.toString()
}
