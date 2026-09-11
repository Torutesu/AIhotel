// Vitest の共通セットアップ（#45）
import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/react"
import { afterEach, beforeEach, vi } from "vitest"

beforeEach(() => {
  // トークンはテストごとに空から始める（localStorage はテスト間で共有されるため）
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
