---
description: 全ワークスペースの検証パイプライン（型チェック→テスト→ビルド）を実行し、結果を要約する
allowed-tools: Bash(pnpm --filter *), Bash(pnpm test *)
---

コミット・PR前の必須検証を順に実行し、失敗があれば該当出力を示して原因を特定してください。

1. `pnpm --filter backend db:generate`（Prismaクライアント生成。type-checkの前提）
2. `pnpm --filter './*' type-check`
3. `pnpm --filter backend test`
4. `pnpm --filter backend build`
5. `pnpm --filter frontend build`

すべて通ったら「検証OK」と各ステップの結果を1行ずつ報告。失敗時は修正案を提示（勝手に修正はせず、まず報告）。
