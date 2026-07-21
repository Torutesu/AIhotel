# CLAUDE.md

@AGENTS.md

## Claude Code 固有

- 詳細な判断基準（テナント分離パターンのコード例、冪等seed等）: `.claude/skills/hotel-revenue-rules/SKILL.md`
- スラッシュコマンド: `/check`（全検証パイプライン）、`/db-migrate <name>`（スキーマ変更→マイグレーション生成）、`/pre-pr`（PR前セルフレビュー）
- `.env` / `.env.local` の読み取り・コミットは settings.json で遮断済み。必要な変数は `backend/.env.example` を参照
