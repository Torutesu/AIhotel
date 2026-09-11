import path from "node:path"
import { fileURLToPath } from "node:url"

import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

const dirname = path.dirname(fileURLToPath(import.meta.url))

// フロントエンドの単体テスト（#45）。
// Next.js のビルドを介さず、lib/ のロジックと components/ の振る舞いを jsdom 上で検証する。
// tsconfig の paths（@/* と @shared/*）はここで同じものを alias として再定義する。
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": path.resolve(dirname, "../shared"),
      "@": path.resolve(dirname, "."),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["{lib,components,hooks}/**/*.test.{ts,tsx}"],
    // Next.js のビルド成果物とカバレッジ対象外のディレクトリを除外する
    exclude: ["node_modules/**", ".next/**"],
  },
})
