---
description: PR作成前のセルフレビュー。差分をプロジェクトルールと照合し、検証パイプラインを実行して結果を報告する
allowed-tools: Bash(git status *), Bash(git diff *), Bash(git log *), Bash(pnpm --filter *), Read, Grep
---

現在のブランチをmainと比較し、PR前セルフレビューを実施してください。

1. `git log main..HEAD --oneline` と `git diff main...HEAD --stat` で変更範囲を把握
2. 差分を以下のルールと照合し、違反を列挙（.claude/skills/hotel-revenue-rules/SKILL.md 基準）:
   - 新規ルートに authenticate / requireHotelAccess / zod検証が揃っているか
   - 新規Prismaモデルに tenantId があるか、スキーマ変更にマイグレーションファイルが付随しているか
   - シークレットのハードコード・フォールバックが混入していないか（`grep -rE "secret|password|API_KEY"` を差分に対して実行）
   - フロントエンドで lib/api.ts を経由しない fetch が増えていないか
   - コミットメッセージが規約（Conventional Commits + 指摘ID）に従っているか
3. 検証パイプライン実行: db:generate → 全type-check → backend test → 両build
4. 結果を「マージ可否の結論 → 違反・懸念のリスト → 検証結果」の順で報告。修正はユーザーの指示を待つ
