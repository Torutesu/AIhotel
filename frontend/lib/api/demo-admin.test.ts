import { describe, it, expect, beforeEach } from "vitest"
import { demoAdmin, DEMO_CURRENT_IP } from "./demo-admin"

// デモモードで運営の管理画面を試すためのブラウザ内データ

describe("demoAdmin", () => {
  beforeEach(() => window.sessionStorage.clear())

  it("トライアルを発行するとその ID でログインでき、期限切れ・停止中は断る", () => {
    const { trial, password } = demoAdmin.createTrial({ name: "○○販売店", kind: "DEALER", days: 30 })
    expect(trial).toMatchObject({ status: "ACTIVE", daysLeft: 30 })
    expect(demoAdmin.trials()).toHaveLength(1)

    expect(demoAdmin.trialLogin(trial.loginEmail!, password)).toMatchObject({ name: "○○販売店" })
    expect(demoAdmin.trialLogin(trial.loginEmail!, "wrong")).toBeNull()

    demoAdmin.updateTrial(trial.id, { isActive: false })
    expect(() => demoAdmin.trialLogin(trial.loginEmail!, password)).toThrow()
    demoAdmin.updateTrial(trial.id, { isActive: true })

    const reset = demoAdmin.resetTrialPassword(trial.id)
    expect(demoAdmin.trialLogin(trial.loginEmail!, password)).toBeNull()
    expect(demoAdmin.trialLogin(trial.loginEmail!, reset.password)).not.toBeNull()

    expect(() => demoAdmin.updateTrial(trial.id, { extendDays: 90 })).toThrow("90日以内")
    demoAdmin.deleteTrial(trial.id)
    expect(demoAdmin.trials()).toHaveLength(0)
  })

  it("IP 制限は今のアクセス元が入っていないと有効にできず、運営が解除できる", () => {
    expect(() => demoAdmin.updateIpRestriction({ enabled: true, entries: [{ cidr: "198.51.100.0/24", label: null }] })).toThrow(
      DEMO_CURRENT_IP,
    )
    const saved = demoAdmin.updateIpRestriction({ enabled: true, entries: [{ cidr: DEMO_CURRENT_IP, label: "本社" }] })
    expect(saved.enabled).toBe(true)
    expect(demoAdmin.tenants()[0].ipRestrictionEnabled).toBe(true)

    demoAdmin.disableTenantIpRestriction(demoAdmin.tenants()[0].id)
    expect(demoAdmin.ipRestriction().enabled).toBe(false)
  })

  it("テナントの追加は同じコードを弾く", () => {
    demoAdmin.createTenant({ name: "A社", code: "a-sha" })
    expect(() => demoAdmin.createTenant({ name: "A社2", code: "a-sha" })).toThrow("既に登録")
    expect(demoAdmin.tenants()).toHaveLength(2)
  })
})
