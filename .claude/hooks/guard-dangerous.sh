#!/bin/bash
# PreToolUse(Bash) フック: このプロジェクトで特に危険な操作をブロックする。
# exit 2 で当該ツール実行を拒否し、stderr の理由が Claude に渡る。

input=$(cat)

command=$(printf '%s' "$input" | python3 -c "import json,sys; print(json.load(sys.stdin).get('tool_input',{}).get('command',''))" 2>/dev/null)

[ -z "$command" ] && exit 0

# 引用符内文字列（コミットメッセージ等）を除外し、実引数のみを判定対象にする。
# 複数行のコミットメッセージにも対応するため sed ではなく python の DOTALL で除去する
stripped=$(printf '%s' "$command" | python3 -c "
import re, sys
s = sys.stdin.read()
s = re.sub(r'\"[^\"]*\"', ' ', s, flags=re.S)
s = re.sub(r\"'[^']*'\", ' ', s, flags=re.S)
print(s)
")

# 1) .env ファイルのコミット防止（.env.example は許可）
# トークンが .env / .env.local で「終わる」場合のみパスとみなす（dotenv 等の語を誤検知しない）
if printf '%s' "$stripped" | grep -qE 'git (add|commit)' && \
   printf '%s' "$stripped" | tr ' \t' '\n\n' | grep -qE '(^|/)\.env(\.local)?$'; then
  echo "ブロック: .env ファイルを git add/commit しようとしています。シークレットはコミット禁止です（.env.example のみ可）。" >&2
  exit 2
fi

# 2) 破壊的マイグレーション防止
if printf '%s' "$stripped" | grep -qE 'migrate reset|--force-reset|--accept-data-loss'; then
  echo "ブロック: 破壊的マイグレーション（migrate reset / --force-reset / --accept-data-loss）は禁止です。必要ならユーザーに確認してください。" >&2
  exit 2
fi

# 3) 本番DBへの直接接続防止（マネージドDBのホスト名を検知）
if printf '%s' "$stripped" | grep -qE 'rds\.amazonaws\.com|cloudsql|\.sql\.goog'; then
  echo "ブロック: 本番/クラウドDBへの直接接続とみられるコマンドです。本番DB操作はCI/CDまたは手動運用で行ってください。" >&2
  exit 2
fi

exit 0
