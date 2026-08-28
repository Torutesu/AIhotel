# 運用手順

本番環境の運用手順。設計の背景は `SAAS_DECISIONS.md`、初期設定の考え方は `SAAS_ONBOARDING.md` を参照。

---

## 1. デプロイ前の必須確認

ホスティング先は未定（D-03）だが、**どのクラウドでも以下は必須**。

### 1.1 DBロールの分離（最重要）

テナント分離（RLS / D-01）は、**接続ロールが superuser でも BYPASSRLS でもない場合にのみ機能する**。
マネージドDBの既定ユーザー（Cloud SQL の `postgres`、RDS のマスターユーザー等）で
アプリを接続すると、ポリシーを書いていても一切効かない。

```bash
# 1. マイグレーション適用（管理ロールで）
DATABASE_URL="$DIRECT_DATABASE_URL" pnpm --filter backend db:migrate:prod

# 2. アプリ用ロールを作成（初回のみ）
APP_DB_PASSWORD="$(openssl rand -base64 32)" \
  pnpm --filter backend db:rls-role

# 3. 確認: 両方とも f であること
psql "$DIRECT_DATABASE_URL" -c \
  "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname='app_user';"
```

環境変数は2つに分ける:

| 変数 | 使うロール | 用途 |
|---|---|---|
| `DATABASE_URL` | `app_user` | アプリ実行（RLSが効く） |
| `DIRECT_DATABASE_URL` | 管理ロール | マイグレーション・seed |

### 1.2 接続数の見積り

リクエスト処理全体を1トランザクションで包む（D-01）ため、接続を長めに保持する。
オートスケールする実行基盤では、**最大インスタンス数 × Prisma の `connection_limit`**
がDBの接続上限を超えないようにする。

- `DB_TRANSACTION_TIMEOUT_MS`（既定20秒）を超える処理は失敗する
- CSVインポートは最大1100行を1トランザクションで扱うため、タイムアウトに余裕を見る

### 1.3 その他

- `JWT_SECRET` は32文字以上（未設定なら起動時に停止する）
- `MAIL_DRIVER=smtp` と SMTP接続情報（D-04）。送信ドメインの SPF / DKIM / DMARC を設定する
- `APP_BASE_DOMAIN` を設定するとサブドメインでテナントを解決する（D-08）。
  ワイルドカード証明書が必要
- フロントエンドは `NEXT_PUBLIC_DEMO_MODE=false` を設定する
  （未設定だとバックエンド接続不可時にデモデータを表示する）

---

## 2. マイグレーションの適用

### 2.1 手順

```bash
# 1. 適用前にバックアップを取得（マネージドDBのスナップショット機能を使う）

# 2. 適用内容を確認する
pnpm --filter backend exec prisma migrate status

# 3. 適用（管理ロールで。開発用の migrate dev は本番で使わない）
DATABASE_URL="$DIRECT_DATABASE_URL" pnpm --filter backend db:migrate:prod

# 4. 新しいテーブルを追加した場合、app_user に権限が付いているか確認する
#    （ALTER DEFAULT PRIVILEGES で自動付与されるが、別ロールが作成した場合は付かない）
psql "$DIRECT_DATABASE_URL" -c "\dp"
```

### 2.2 ロールバック方針

**Prisma にダウンマイグレーションはない。** 前進のみで対応する。

| 変更の種類 | 戻し方 |
|---|---|
| 列・テーブルの追加 | 影響が小さいので放置してよい。アプリを前バージョンに戻すだけ |
| 列の削除・改名 | 打ち消す新しいマイグレーションを書く。データが失われていればバックアップから復旧 |
| データ破壊を伴う変更 | バックアップからのリストア。**適用前にスナップショットを取ることが前提** |

破壊的変更は「①新列を追加 → ②両方に書く → ③読み替え → ④旧列を削除」の
4段階に分けると、各段階でロールバックできる。

### 2.3 新しいモデルを追加するときの必須事項

`AGENTS.md` の必須ルールに従うこと。特に:

- `tenantId` ＋ tenantリレーション ＋ `@@index([tenantId])`
- **RLSポリシー**（`ENABLE` / `FORCE ROW LEVEL SECURITY` ＋ `tenant_isolation`）。
  付け忘れるとそのテーブルだけ分離が外れる
- 追加後は `pnpm --filter backend test:rls` でテナント越え遮断を確認する

---

## 3. 定期実行

| ジョブ | コマンド | 推奨頻度 |
|---|---|---|
| データ保持期間にもとづく掃除（D-06） | `pnpm --filter backend db:cleanup` | 1日1回（深夜） |

外部スケジューラ（cron / Cloud Scheduler 等）から呼ぶ。ジョブ基盤には依存しない。
1テナントの失敗で全体は止まらず、結果は構造化ログに出る。

---

## 4. 監視

### 4.1 ヘルスチェック

| エンドポイント | 内容 |
|---|---|
| `GET /health` | プロセスの生存のみ。ロードバランサ用 |
| `GET /api/health` | **DBへの疎通を含む**。異常時は 503 を返す |

外形監視は `/api/health` を見ること。`/health` はDBが落ちていても 200 を返す。

### 4.2 まだ入っていないもの

エラートラッキング（Sentry等）とアラート通知は未導入。
現状は構造化ログ（pino / JSON）のみで、障害は顧客からの連絡でしか気づけない。

---

## 5. テナントの解約

提供側ADMIN（`tenantId` を持たないアカウント）のみ実行できる。
**書き出し → 無効化 → 削除** の順で進める。

```bash
# 1. データを書き出して顧客へ返却する（認証情報は含まれない）
curl -H "Authorization: Bearer $TOKEN" \
  "$API/api/v1/admin/tenants/$TENANT_ID/export" > tenant-export.json

# 2. 無効化する。ログインとトークン更新が即座に拒否される。データは残るので復旧可能
curl -X POST -H "Authorization: Bearer $TOKEN" \
  "$API/api/v1/admin/tenants/$TENANT_ID/deactivate"

# 3. 完全に削除する（取り消し不可）。無効化済みかつテナントコードの入力が必要
curl -X DELETE -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"confirmationCode":"<テナントコード>"}' \
  "$API/api/v1/admin/tenants/$TENANT_ID"
```

有効なテナントは削除できない（先に無効化が必要）。
削除は関連データをすべて消し、監査ログにテナント名とコードを残す。

---

## 6. トラブルシューティング

| 症状 | 確認すること |
|---|---|
| データが1件も取得できない | アプリの接続ロールに `app_user` を使っているか。テナントコンテキストが張られているか（未認証だとRLSで0件になる） |
| RLSが効いていない | 接続ロールが superuser / BYPASSRLS でないか（`pg_roles` を確認） |
| ログインできない | テナントが無効化されていないか。同じメールが複数テナントにあり組織コードが必要でないか |
| 招待メールが届かない | `MAIL_DRIVER` が `log` のままでないか。SPF/DKIM の設定漏れ |
| 施設全員がログインできない | レート制限。メールアドレス単位に加えIP単位の上限もある（`LOGIN_SOURCE_RATE_LIMIT_MAX`） |
| トランザクションのタイムアウト | `DB_TRANSACTION_TIMEOUT_MS`。CSVインポートなど長い処理で不足していないか |
