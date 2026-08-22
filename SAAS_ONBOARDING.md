# SaaS設定分類とテナントオンボーディング設計

SaaSとして複数テナントに販売していく前提で、**可変（テナントごとに初期設定が必要なもの）**と
**固定（全テナント共通のもの）**を切り分けて整理する。あわせて初期設定オペレーションの
標準フローと自動化ロードマップを定義する。

対象読者: 開発者・導入オペレーション担当。機能仕様は `要件定義書.md`、環境構築は `SETUP.md` を参照。

---

## 1. 設定の4層モデル

すべての「設定」を以下の4層に分類する。**層が上がるほど変更頻度が低く、変更手段が重くなる。**

| 層 | 名称 | スコープ | 変更手段 | 変更者 |
|---|---|---|---|---|
| L1 | システム固定 | 全テナント共通 | コード変更＋デプロイ | 開発チーム |
| L2 | 環境設定 | デプロイ環境ごと | 環境変数（`backend/src/lib/config.ts`） | 運用チーム |
| L3 | テナント初期設定 | テナント／ホテルごと | 管理画面・API・オンボーディング作業 | 導入担当＋顧客 |
| L4 | 運用データ | ホテルごと・日次 | 日々の業務入力・バッチ | 顧客（現場） |

**判断基準**: 新しい設定値を追加するときは「テナントAとテナントBで値が変わりうるか？」を問う。
変わりうるなら L3（DBに tenantId/hotelId 付きで持つ）、変わらないなら L1（コード定数・enum）、
デプロイ環境（dev/staging/prod）で変わるなら L2（config.ts）。

---

## 2. L1: システム固定（全テナント共通・再議論しない）

`AGENTS.md` の「ドメイン確定値」と対応。**顧客要望があっても個別テナント向けに変えない。**
変える場合は全テナント一斉のプロダクト仕様変更として扱う。

| 項目 | 値 | 定義場所 |
|---|---|---|
| ユーザーロール | ADMIN / MANAGER / OPERATOR の3種 | `schema.prisma` enum `UserRole` |
| 需要レベル | A〜E の5段階 | `schema.prisma` enum `DemandLevel` |
| 料金ランクの**上限** | 最大40段階（実際の段階数・価格はL3） | `seed.ts` `PRICE_RANK_COUNT`、バリデータ |
| 価格戦略の重み**制約** | 稼働率/ADR/競合の合計=100%（配分値はL3） | `lib/validators.ts` |
| アラート体系 | RED/YELLOW × レベル1〜5、ダッシュボード表示は5・4のみ | `schema.prisma` `Alert`（F-DASH-05） |
| 認証方式 | JWT＋リフレッシュトークン（SHA-256ハッシュ保存） | `lib/auth.ts` `hashToken()` |
| API契約 | `/api/v1/<領域>`、`{success, data}` / `{success, error}` | `utils/response.ts` / `errorHandler.ts` |
| テナント分離 | 全モデルに `tenantId`＋`@@index([tenantId])`、クエリは必ず絞り込み | `schema.prisma` 全体 |
| UI言語 | 日本語 | frontend全体 |
| 技術スタック | Express+TS+Prisma+PostgreSQL（クラウド固有SDK禁止） | `AGENTS.md` |

準固定（コード上は String だが実質共通の語彙として運用しているもの）:

- OTAチャネル名: 楽天トラベル・じゃらん・一休・Expedia・Agoda・公式（`OtaChannelData.channel`、`Competitor.otaUrls` のキー）
- レビューソース: google / tripadvisor / rakuten / jalan（`ReviewScore.source`）
- イベント種別: concert / sports / conference / festival（`Event.type`）

→ 将来テナントごとに独自チャネルが必要になった時点で L3 のマスタテーブルに昇格させる。
それまでは enum 化せず String のまま、この語彙をアプリ側の定数として扱う。

---

## 3. L2: 環境設定（デプロイ環境ごと・テナント非依存）

読み込み・検証は `backend/src/lib/config.ts` に集約済み（`process.env` 直接参照はESLintで禁止）。
一覧とサンプル値は `backend/.env.example` が正。

| 分類 | 変数 | 備考 |
|---|---|---|
| サーバー | `NODE_ENV` `PORT` `FRONTEND_URL` | |
| DB | `DATABASE_URL` | 標準 `postgresql://` のみでクラウド差し替え可 |
| 認証 | `JWT_SECRET`（32文字以上必須・未設定は起動時throw） `JWT_EXPIRES_IN` `JWT_REFRESH_EXPIRES_IN` | フォールバック値のコード埋め込み禁止 |
| レート制限 | `RATE_LIMIT_WINDOW_MS` `RATE_LIMIT_MAX_REQUESTS` `LOGIN_RATE_LIMIT_MAX` | |
| ログ | `LOG_LEVEL` `LOG_FORMAT` | |
| ストレージ | `STORAGE_DRIVER`（現在 local のみ） `STORAGE_LOCAL_DIR` | S3/GCS追加時もここだけ |
| 将来（Phase 4） | `ANTHROPIC_API_KEY`・OTA各社APIキー・`WEATHER_API_KEY`・`REDIS_URL` | `.env.example` にコメントで予約済み |

**運用ルール**: これらは「テナントごと」には絶対に分岐させない。テナント別の外部APIキー
（例: テナント所有の楽天アカウント）が必要になったら、それは L3 としてDBに暗号化保存する設計に切り出す。

---

## 4. L3: テナント初期設定（オンボーディングの本体）

新規テナント受け入れ時に投入するデータ。**必須／デフォルトあり／任意**に分けると、
オンボーディングのクリティカルパスが明確になる。

### 4.1 必須（これが無いと画面が成立しない）

| # | 対象 | モデル | 内容 | 現状の投入手段 |
|---|---|---|---|---|
| 1 | テナント | `Tenant` | name, code（一意） | `POST /api/v1/admin/tenants`（一括プロビジョニング） |
| 2 | ホテル | `Hotel` | name, totalRooms, address/phone/email | 同上（更新は `PUT /api/v1/settings/hotel/:id`） |
| 3 | 初期ユーザー | `User` | 顧客側 MANAGER/OPERATOR ＋提供側 ADMIN | 同上（MANAGER/OPERATORを同時作成。ADMINは対象外） |
| 4 | 客室タイプ | `RoomType` | code, name, capacity, count, sortOrder | DB直接（API未実装） |
| 5 | 料金ランク | `PriceRank` | rank(1〜40), label, price1P/2P/3P/4P | `POST /api/v1/settings/price-ranks/generate`（一括生成）＋ `POST/PUT /api/v1/settings/price-ranks`（個別調整） |

### 4.2 デフォルトありで稼働可（後から調整）

| 対象 | モデル・フィールド | デフォルト | 変更手段 |
|---|---|---|---|
| 週末定義 | `Hotel.weekendDays` | `[5, 6]`（金・土） | `PUT /api/v1/settings/hotel/:id`（F-SET-01） |
| 価格戦略の重み | `PricingStrategyConfig` | 稼働率40 / ADR40 / 競合20 | 設定画面（F-DP-02） |

※ `weekendDays` はコードでハードコードせず必ず `Hotel.weekendDays` を参照する（AGENTS.md 必須ルール）。

### 4.3 任意（導入後1〜2週間で順次投入）

| 対象 | モデル | 備考 |
|---|---|---|
| 競合ホテル | `Competitor` | 最大5社＋OTA別URL（F-SET-03。URL提供待ちの顧客が多い前提） |
| 月次予算・前年実績 | `MonthlyBudget` | budget* と lastYear* 。前年実績は過去データ移行の受け皿 |
| イベント | `Event` | 地域イベント。運用開始後にOPERATORが随時登録（F-DP-07） |
| 団体客ルール | `GroupBooking.revenueImpactRule` | F-SET-05、仕様協議中（課題No.53）。Json で柔軟に保持 |

### 4.4 L4: 運用データ（初期設定ではなく蓄積・移行対象）

`DailyData` / `DailyRoomData` / `BookingCurveData` / `OtaChannelData` / `CompetitorPriceData` /
`AiPriceRecommendation` / `MonthlyLandingSimulation` / `KpiSnapshot` / `ReviewScore` /
`Alert` / `AiComment` / `AuditLog` / `RefreshToken`

- オンボーディングでは投入しない（Phase 4 の PMS/OTA連携・バッチで自動蓄積する領域）
- 例外: **過去実績の移行**。顧客が過去データを持ち込む場合は `DailyData`（日次実績）と
  `MonthlyBudget.lastYear*`（月次前年比較）にインポートする。それ以外の分析系テーブルは移行不要
  （蓄積されれば自然に埋まる）

---

## 5. 標準オンボーディングフロー

```
Day 0  契約・ヒアリングシート受領
        └ ホテル基本情報 / 客室タイプ一覧 / 料金レンジ（最低〜最高価格）/
          週末定義 / 競合5社とOTA URL / 月次予算 / 過去実績CSV
Day 1  環境確認（L2は共有環境のため作業なし）
        1. Tenant 作成（code は英小文字ケバブケース。例: fujita-kanko）
        2. Hotel 作成（totalRooms, weekendDays）
        3. RoomType 投入
        4. PriceRank 投入（料金レンジから40段階を機械生成 → 顧客レビューで調整）
        5. User 発行（MANAGER/OPERATOR、初期パスワードは初回ログイン時変更）
Day 2〜 顧客側作業（デフォルトのまま開始可）
        6. 価格戦略の重み調整（40/40/20 から）
        7. 競合ホテル・OTA URL登録
        8. 月次予算・前年実績の投入
        9. 過去実績データ移行（任意）
```

**完了判定チェックリスト**（4.1 の5項目が揃っているか）を導入担当がレビューしてから引き渡す。

---

## 6. 初期設定の省力化・自動化ロードマップ

現状の `backend/prisma/seed.ts` は**デモデータ専用**（demo-tenant 固定・擬似乱数で実績生成）であり、
本番テナントのプロビジョニングには使えない。以下を段階的に実装する。

### Step 1: テナントプロビジョニングの一括化 — **実装済み**
- `POST /api/v1/admin/tenants`（ADMIN専用・監査ログ記録）。
  Tenant＋Hotel＋初期User（MANAGER/OPERATOR）＋`PricingStrategyConfig`（デフォルト40/40/20）を
  **1トランザクション**で作成。`priceRanks` パラメータ指定時は料金ランクも同時生成
- 実装: `backend/src/services/provisioningService.ts` の `provisionTenantService()`
  （seed.ts のデモ生成とはコードパス分離済み）

### Step 2: 料金ランク40段階の自動生成 — **実装済み**
- `POST /api/v1/settings/price-ranks/generate`（MANAGER以上・監査ログ記録）。
  入力は1名利用の下限・上限価格（＋2〜4名の倍率、デフォルト 1.4 / 1.8、100円単位丸め）
- 線形補間で最大40段階を機械生成。既存ランクがある場合は `replaceExisting: true` を
  明示しない限りエラー（誤上書き防止）。生成後は既存の個別更新APIで微調整する運用
- 実装: `provisioningService.ts` の `generatePriceRankRows()`（純粋関数・テスト付き）

### Step 3: CSV一括インポート
- 対象: RoomType / MonthlyBudget（前年実績含む）/ 過去 DailyData
- ヒアリングシート（スプレッドシート）の様式とCSVカラムを一致させ、転記作業を廃止

### Step 4: セットアップウィザードUI
- 設定タブに「初期設定ウィザード」を追加し、4.1 の必須5項目を順に入力させる
- 未完了項目は既存のアラート基盤（level 2「翌月の予算未登録」と同様のパターン）で可視化

### Step 5: オンボーディング完了率の計測
- テナントごとの必須項目充足状況を返す `GET /api/v1/admin/tenants/:id/onboarding-status` を用意し、
  導入担当のダッシュボードとする

---

## 7. 実装時の注意（このドキュメントに関わる範囲）

- L3 のテーブルを追加するときは必ず `tenantId`＋tenantリレーション＋`@@index([tenantId])` を付与
- プロビジョニングAPIも通常ルールに従う: `authenticate`＋`requireRole('ADMIN')`＋zodバリデーション＋監査ログ
- デフォルト値は schema.prisma の `@default` と本ドキュメントの表を一致させて管理する
  （weekendDays `[5,6]`・重み 40/40/20 を変えるときは両方更新）
- seed.ts はデモ・開発用として維持し、本番プロビジョニングのコードパスと混ぜない
