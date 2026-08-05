# 14. 詳細設計（データモデル・バッチ・API・テナント分離）

版: 0.1（ドラフト）
アルゴリズム（13）以外の詳細設計。現行 `schema.prisma` からの拡張を具体化する。

---

## 1. データモデル拡張案（Prismaスキーマ差分の設計）

### 1.1 テナント階層（新設）

```
Tenant（運営会社）
  id, name, status(active/suspended), plan, createdAt
  └─ Hotel（既存を拡張: tenantId 追加、timezone, checkInBoundary(日付境界時刻) 追加）
       └─ User（既存: hotelId → tenantId+hotelId。テナント管理者はhotelId=null）
```

- 既存の全ドメインテーブルは hotelId 経由でテナントに帰属（hotelIdスコープを維持し、tenantIdはHotel経由で解決）
- 運営側ユーザーは別モデル `OperatorUser`（SC-99用。テナントUserと認証空間を分ける）

### 1.2 予約明細（新設・最重要）

```
Reservation
  id, hotelId, externalId(サイトコントローラー側ID), sourceAdapter(T0〜T3/ベンダー名)
  bookedAt(予約受付日時)                    … ブッキングカーブのas-of軸
  canceledAt?, status(active/canceled/lost) … lost=ソースから消失(照合用)
  checkIn, checkOut, nights
  roomTypeId, roomCount, guests(adults/children)
  channelId, planCode?, rateType?(flex/nonref)
  totalRoomRevenue, currency
  isGroup(団体フラグ), groupId?
  region?/country?(居住地・匿名粒度)
  rawRef(raw層への参照), importJobId
  updatedAt, revision(遡及修正の版数)
  @@unique([hotelId, externalId, revision])
  @@index([hotelId, checkIn]) @@index([hotelId, bookedAt])
```

- 連泊は予約1行+泊数展開ビュー（`ReservationNight`はビュー/集計で持ち、実体化はOTBスナップショットが担う）
- 個人情報（氏名・連絡先）は**列を作らない**（NFR-04）

### 1.3 OTBスナップショット（新設）

```
OtbSnapshot
  hotelId, snapshotDate(as-of), stayDate
  roomTypeId?, channelId?, guestBucket?(1/2/3/4+), isGroup?
  rooms, roomsNet(キャンセル予測適用前の確定ネット), revenue, guests
  @@unique([hotelId, snapshotDate, stayDate, roomTypeId, channelId, guestBucket, isGroup])
```

- 生成: 日次バッチでReservationから集計（NULL次元=全体行も同時生成し、画面はロールアップ済み行を読む）
- **snapshotDateの欠損を許さない**（バッチ失敗日は翌日に遡及生成）。ブッキングカーブAPIはこのテーブルのみ参照
- 容量試算: 1ホテル 365(snapshot)×365(stay)×次元組合せ ≈ 数百万行/年 → パーティション（hotelId, snapshotDate月）+古いスナップショットの間引き（1年超は週次粒度に集約）を初期設計に含める

### 1.4 その他の新設テーブル

| テーブル | 主キー/主要列 | 備考 |
| --- | --- | --- |
| Channel | hotelId, code, name, otaGroup | チャネルマスタ。未知コードは保留キュー経由で人間がマッピング |
| PriceHistory | hotelId, stayDate, roomTypeId, effectiveAt, rank, price1P..4P, source(recommended/manual/imported) | 自社設定価格のas-of履歴。弾力性学習の生データ |
| Budget | hotelId, month, metric(occ/adr/revenue), value, dailyAllocation(JSON?) | 予算マスタ。日割りルールは設定で選択（均等/曜日重み） |
| ExternalFactor | source, factorType, targetDate, observedAt, geoScope, value(JSON), reliability | 12-B。(targetDate, observedAt)の2軸必須 |
| EventRegistry | hotelId?, name, venue, category, startDate, endDate, distanceKm, capacity, liftOverride? | 手動登録+コネクタ取込。カテゴリは13-§4のlift学習キー |
| Prediction | hotelId, stayDate, asOf, segment, predictedOccupancy, predictedAdr, p10/p90, demandLevel, confidence, modelVersion | 全予測を永続化（評価の土台） |
| Recommendation | hotelId, stayDate, roomTypeId, asOf, rank, alternatives(JSON), explanation(JSON=根拠契約), guardrailsApplied(JSON), modelVersion | 根拠JSONは12-D-2の契約そのまま |
| PricingDecision | recommendationId, userId, action(adopt/modify/reject), modifiedRank?, reasonCode?, note, decidedAt | 弾力性学習・採用率KPIの入力 |
| ConnectorConfig | hotelId, kind(siteController/rateShopper/weather/...), adapterType, credentialsRef(暗号化Vault参照), schedule, formatVersion, enabled | FR-S07。credentialsは本体DBに平文で置かない |
| ImportJob | hotelId, kind, startedAt, finishedAt, status, stats(JSON: 新規/更新/キャンセル/エラー件数), rawRef | 取込の監査・SC-11の表示元 |
| CompetitorPriceData（拡張） | + guestBucket, roomClass, isSoldOut, observedAt | 人数軸・満室シグナル・as-of追加（G6ギャップ対応） |

### 1.5 マイグレーション留意点
- 既存 `DailyData` は「確定実績のサマリ」として残す（PMS確定値との突合先）。AI予測列は Prediction へ移し、DailyDataからは段階的に削除
- 料金ランク表の**版管理**: PriceRank に validFrom を追加（ランク表改定後も過去の推奨を当時の表で解釈できるように）

## 2. バッチ設計（ジョブDAG）

```
[02:00] ingest.site_controller (テナント×ホテル並列, アダプタ別)
[03:00] ingest.external.*     (competitor / weather / events / fx ... 相互独立・並列)
[04:00] build.otb_snapshot    ← ingest.site_controller 成功に依存
        build.aggregates      (基本分析の事前集計) ← otb_snapshot
[05:00] predict.demand        ← otb_snapshot + external (externalは「あるもので実行」= 欠損時は前回値+鮮度フラグ)
        optimize.pricing      ← predict.demand
[06:00] llm.batch_comments    ← optimize.pricing (失敗しても推奨自体は出す=非致命)
[07:00] verify.pipeline       (全ジョブの成否集約 → 鮮度ステータス更新 → 通知)
[月次]  train.baseline / train.event_lift / train.cancel_hazard
[四半期] train.elasticity (人間レビュー付きデプロイ)
```

- 実装: フェーズ1はジョブテーブル+cron（`Job(id, kind, hotelId, scheduledAt, startedAt, status, attempt, payload)`）。依存関係はオーケストレータ関数で明示。規模拡大時にBullMQ等へ移行できるようジョブ定義をデータ化しておく
- **テナント並列と隔離**: ジョブは (kind, hotelId) 単位。1テナントの失敗が他テナントをブロックしない。同一外部ソース（天気等）は全テナント共有で1回だけ取得
- 冪等性: 全ジョブは同一 (kind, hotelId, 対象日) の再実行で同じ結果（upsert設計）。手動再実行はSC-11/SC-99から
- 鮮度ステータス: `DataFreshness(hotelId, domain, lastSuccessAt, slaHours, status)` を verify が更新し、全画面のバナー表示（NFR-03）が参照

## 3. API詳細（契約の要点）

### 3.1 共通
- `ApiResponse<T>` エンベロープ、ISO8601日付、エラーコード体系（`AUTH_*, TENANT_*, DATA_STALE, VALIDATION_*`）
- **テナントスコープ強制**: JWTに tenantId+hotelIds を格納。全リポジトリ関数は hotelId 引数必須（省略不可のシグネチャ）+ Prismaミドルウェアで hotelId 条件の存在を検証（NFR-09の実装規約）。テナント越境は403+監査ログ
- 予測系レスポンスは必ず `asOf` と `freshness` を含む

### 3.2 主要エンドポイント（11の画面API案の確定版リスト）

```
auth:      POST /auth/login | /auth/refresh | /auth/logout
dashboard: GET /dashboard/kpi | /dashboard/trend | /dashboard/alerts | /dashboard/ai-comment
pricing:   GET /pricing/calendar | /pricing/ranks | /pricing/{stayDate}/explanation
           POST /pricing/decisions | PUT /pricing/strategy-weights | PUT /pricing/{stayDate}/event-info
daily:     GET /daily | /daily/booking-curve
analysis:  GET /analysis?dimension= | GET /analysis/cross | GET/POST /analysis/cross-settings
competitors: GET /competitors | POST/PUT/DELETE /competitors | GET /competitors/comparison
campaigns: CRUD /campaigns
ai:        GET /ai-summary/forecast | POST /chat (SSE)
reports:   POST /reports/generate | GET /reports | CRUD /reports/schedules
settings:  GET/PUT /settings | GET/PUT /price-ranks | POST /budgets/import
ingest:    GET /connectors/status | POST /imports | GET /imports/{id}/validation | POST /imports/{id}/commit
onboarding: POST /tenants (operator) | POST /hotels | POST /hotels/{id}/setup/* (ウィザード各ステップ)
operator:  GET /op/tenants | GET /op/jobs | POST /op/jobs/{id}/retry  (別認証空間)
```

- ブッキングカーブAPIの契約（代表例）:
```
GET /daily/booking-curve?hotelId&stayDate&groupBy=total|guests|roomType|channel
    &granularity=day|month&mode=gross|net&compare=lastYear,baseline
→ { stayDate, series: [{ key, points: [{leadTime, otbRooms, otbAdr, avgSellPrice}] }],
    comparisons: {...}, freshness: {...} }
```

## 4. 予測サービスの分離設計（フェーズ3準備）

- フェーズ2: Node内 `prediction/` モジュール（純関数群+SQL集計）。**入出力を13の契約（feature_view → Prediction/Recommendation行）に固定**しておく
- フェーズ3: 同じ契約でPython(FastAPI)サービスに置換。通信は同期HTTP（バッチから呼ぶだけなのでキュー不要）。モデル成果物はオブジェクトストレージ+modelVersionで管理
- どちらの実装でも Prediction/Recommendation テーブルだけが下流（API/LLM/評価）との接点 — サービス境界=テーブル契約

## 5. テスト戦略（アルゴリズム部分）

- **ゴールデンデータテスト**: 合成した予約明細（既知の季節性・イベント・弾力性を埋め込む）で、各推定器が既知パラメータを回収できることをCIで検証
- **リーク検査テスト**: feature_view に observedAt > asOf の行が混入したら失敗するアサーションを常設
- **再現性**: 同一入力→同一推奨（乱数を使う場合はseed固定）。RecommendationにmodelVersion+入力ハッシュを記録
- **バックテストハーネス**: 任意の過去日 t を「今日」としてパイプライン全体を実行できるモード（04の評価を自動化する基盤。スナップショットとas-of設計が効いてくる）

## 6. 本書の要詰め事項

| # | 論点 | 当面の案 |
| --- | --- | --- |
| H-1 | OTBスナップショットの保持ポリシー（間引き粒度） | 1年超は週次に集約 |
| H-2 | credentialsRef の実体（KMS/Vault/クラウドシークレット） | インフラ選定(D1)と同時決定 |
| H-3 | 運営側認証（OperatorUser）の方式 | 社内SSO or 別テーブル+2FA |
| H-4 | レポート生成の実行基盤（PDF化） | 非同期ジョブ+ヘッドレスブラウザ or ライブラリ、フェーズ4で選定 |
| H-5 | チャネルマッピング保留キューの運用（誰がいつ解消するか） | SC-11に未マッピング警告を表示、CS運用 |
