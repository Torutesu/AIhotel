# 需要予測・価格最適化アルゴリズム設計方針

対象: F-DP-01 / F-DP-02 / F-DP-03 / F-DP-05 / F-DP-07 / F-DASH-06
ステータス: 設計ドラフト（実装は Phase 4）。本書は「今どうなっているか」「何を根拠に、どう作り替えるか」を確定させるための土台であり、
実装コードは含まない。確定した仕様は `要件定義書.md` に反映すること。

---

## 0. 3行サマリー

- 現状は**ルールベース v1**（同曜日移動平均 + 前年同日 + イベント/週末の加算）で、価格戦略の重み（稼働率/ADR/競合）は**アルゴリズムに接続されていない**。
- 本質的な設計課題は精度ではなく**構造**にある。現行は「予測稼働率 → 料金ランク」を直接マップしており、**価格が需要に与える影響（価格弾力性）がモデルに存在しない**。
- 「AIがチャットで根拠を答える」を目玉機能にするなら、**説明可能性をモデル選択の制約条件にする**（加法分解可能なモデル → LLMは説明の生成者ではなく翻訳者）。

---

## 1. 現状（as-is）の正確な把握

### 1.1 実装されているアルゴリズム

`backend/src/services/forecast/ruleBasedForecaster.ts`（`MODEL_VERSION = 'rule-based-v1'`）

```
base = MA28(同曜日) * 0.7 + YoY(前年同日±3日) * 0.3     ← 両方ある場合
     | MA28 または YoY 単独                              ← 片方のみ
     | 0.60                                             ← どちらも無い（フォールバック）

predictedOccupancy = clamp(base + eventImpact + weekendAdj, 0, 1)
  eventImpact  = Σ(high:+15pt / medium:+8pt / low:+3pt)   ← Event.expectedImpact
  weekendAdj   = +5pt（Hotel.weekendDays に該当する場合）

demandLevel     = A(>0.9) / B(>0.8) / C(>0.65) / D(>0.5) / E
recommendedRank = clamp(round(predictedOccupancy * maxRank), 1, maxRank)
recommendedPrice = PriceRank[recommendedRank].price1P
confidence      = 0.85 / 0.70 / 0.60 / 0.40（利用できたデータソース数のみで決定）
```

更新は `recomputeForecastService()` の**オンデマンド呼び出し**のみ。バッチジョブは未実装（Phase 4）。
結果は `AiPriceRecommendation` に upsert され、**過去の予測は上書きされて消える**。

### 1.2 現行設計が抱える構造的問題（精度チューニングでは解けないもの）

| # | 問題 | 影響 |
|---|------|------|
| P-1 | **価格が需要モデルに入っていない**。`occupancy → rank` の直接マップは「需要が強い日は高い」という相関の写像にすぎず、「この価格にしたら何室売れるか」を答えられない | 価格最適化になっていない。値上げ余地/値下げ余地を定量化できない |
| P-2 | **価格戦略の重み（`PricingStrategyConfig`）がデッドコンフィグ**。バリデーション（合計100%必須）もUIも監査ログもあるが、`ruleBasedForecaster` は一切参照していない | 設定を変えても推奨価格が1円も動かない。顧客に説明できない |
| P-3 | **ブッキングカーブ（`BookingCurveData`）を予測に使っていない**。ホテルRMの標準手法である pickup / pace 予測が未使用 | リードタイム別の予約進捗（OTB）が反映されず、直近の需要変化に追随できない |
| P-4 | **打ち切り需要（censored demand）を扱っていない**。稼働100%の日は実需要 > 観測値だが、実績をそのまま学習すると需要を過小評価する | 満室連発の高需要日ほど値上げできない（RMで最も損失が大きい失敗） |
| P-5 | **価格の内生性（endogeneity）**。自社が高値を付けた日は売れないため、素の回帰は「高価格 → 低稼働」を過大に学習する | 弾力性推定が偏り、常に値下げ方向へ寄る |
| P-6 | **予測のスナップショットが残らない**。upsert 上書きのため、リードタイム別の精度検証（backtest）ができない | 「AIは当たっているのか」に答えられない。モデル更新の可否を判断できない |
| P-7 | `confidence` がデータソース数のみの定数。実際の誤差分布と無関係 | 「確信度70%」がユーザーに対して意味を持たない（説明機能と相性が悪い） |
| P-8 | **連泊（LOS）を考慮していない**。日別独立に価格を決めている | 2泊目が高ランクだと1泊目の予約ごと失う。イベント日前後の値付けを誤る |
| P-9 | 外部要因が `Event`（手入力）と `DailyData.externalFactors`（自由記述テキスト）のみ | 天候・祝日・為替・市場全体の需要が構造化データとして存在しない |

**重要**: P-1 と P-2 は同じ根に由来する。価格に対する需要の反応がモデルに無いため、「稼働率重視 60% / ADR重視 40%」という設定を反映する計算対象が存在しない。したがって v2 の中核は「需要曲線の導入」になる。

---

## 2. ベースにする技術・論文

「独自AI」を主張するのではなく、**枯れたレベニューマネジメント理論の標準構成を、ホテル1施設・日別・離散40ランクという制約に合わせて実装する**方針を採る。以下は設計判断の根拠として参照する文献。

### 2.1 レベニューマネジメントの基礎理論

| 文献 | 内容 | 本システムでの位置づけ |
|------|------|----------------------|
| Littlewood (1972) *Forecasting and control of passenger bookings*, AGIFORS | 2クラスの限界収益ルール。「安い予約を今受けるか、高い予約を待つか」の期待値比較 | 直販/OTA/団体の受入判断、割引在庫の締切ロジックの原型 |
| Belobaba (1987, 1989) EMSR-a / EMSR-b | 多クラス在庫配分ヒューリスティック | 部屋タイプ×料金クラスの在庫配分（Phase 5候補） |
| Gallego & van Ryzin (1994) *Optimal Dynamic Pricing of Inventories with Stochastic Demand over Finite Horizons*, Management Science 40(8) | 在庫有限・期限有りの動的価格付けの基礎。決定論的近似が漸近最適 | **本システムの主軸**。「残室数 × 残日数」で最適価格が決まるという枠組み |
| Bitran & Mondschein (1995) *An application of yield management to the hotel industry considering multiple day stays*, Operations Research | 連泊を考慮したホテル固有のYM | P-8（LOS問題）の対処方針 |
| Talluri & van Ryzin (2004) *The Theory and Practice of Revenue Management*, Springer | 分野の標準教科書 | 用語・評価指標の統一基準 |
| Talluri & van Ryzin (2004) *Revenue Management Under a General Discrete Choice Model of Consumer Behavior*, Management Science 50(1) | 選択モデル（MNL）に基づくRM | 競合価格を含めた「選ばれる確率」のモデル化（v3候補） |
| Elmaghraby & Keskinocak (2003) *Dynamic Pricing in the Presence of Inventory Considerations*, Management Science | 動的価格付けのサーベイ | 手法選定の見取り図 |

### 2.2 需要予測（ホテル固有）

| 文献 | 内容 | 採用点 |
|------|------|--------|
| Weatherford & Kimes (2003) *A comparison of forecasting methods for hotel revenue management*, International Journal of Forecasting 19(3) | ホテルRMにおける予測手法の比較。pickup 系・指数平滑が総じて強い | **v2のベースラインは pickup 法**にする（複雑なMLより先に、これを超えることを要件にする） |
| Weatherford & Pölt (2002) *Better unconstraining of airline demand data...*, Journal of Revenue and Pricing Management | 打ち切り需要の復元（EM法・projection detruncation） | P-4 の標準解。満室日の実需要を EM で推定してから学習 |
| Hyndman & Athanasopoulos *Forecasting: Principles and Practice* | rolling origin evaluation（時系列CV）、階層時系列 | backtest の設計、ホテル→部屋タイプの整合（reconciliation） |
| Koenker & Bassett (1978) *Regression Quantiles*, Econometrica | 分位点回帰 | 点予測ではなく**予測区間**を出す（`confidence` の実質化） |
| Ke et al. (2017) *LightGBM*, NeurIPS | 勾配ブースティング | v3の本命。表形式・少データ・非線形交互作用に強い |
| Salinas et al. (2020) *DeepAR*, IJF / Lim et al. (2021) *Temporal Fusion Transformer*, IJF | 深層時系列。TFTは変数選択機構により説明性を持つ | 複数ホテル展開後の選択肢。1施設・数年データでは過剰 |
| Angelopoulos & Bates (2021) *A Gentle Introduction to Conformal Prediction* / Gibbs & Candès (2021) *Adaptive Conformal Inference Under Distribution Shift* | 分布仮定なしで被覆率を保証する予測区間 | **`confidence` の正しい定義**。「80%区間に実績が80%入る」を検証可能にする |

### 2.3 価格学習・実験

| 文献 | 内容 | 採用点 |
|------|------|--------|
| Besbes & Zeevi (2009) *Dynamic Pricing Without Knowing the Demand Function*, Operations Research | 需要関数未知下での価格学習（探索と活用） | 弾力性を得るための計画的な価格探索の理論的根拠 |
| Ferreira, Lee & Simchi-Levi (2016) *Analytics for an Online Retailer*, M&SOM | 予測 + 価格最適化の実務適用（Rue La La） | 「予測モデル → 最適化ソルバ」の2段構成という実装アーキテクチャ |
| Ferreira, Simchi-Levi & Wang (2018) *Online Network Revenue Management Using Thompson Sampling*, Operations Research | ベイズ的探索によるRM | 価格探索を「収益を捨てずに」行う方式（v4候補） |
| Li et al. (2010) *A Contextual-Bandit Approach to Personalized News Article Recommendation* (LinUCB), WWW | 文脈付きバンディット | 同上。ただし在庫制約があるため素の適用は不可 |
| Bertsimas & Kallus (2020) *From Predictive to Prescriptive Analytics*, Management Science | 予測から意思決定への接続 | 「予測誤差の最小化 ≠ 収益の最大化」を評価設計に反映 |

### 2.4 説明可能性（目玉機能の技術基盤）

| 文献 | 内容 | 採用点 |
|------|------|--------|
| Lundberg & Lee (2017) *A Unified Approach to Interpreting Model Predictions* (SHAP), NeurIPS | 予測を特徴量ごとの寄与に**加法分解**する統一枠組み | 「なぜこの価格か」を数値の内訳として出す標準手法 |
| Lundberg et al. (2020) *From local explanations to global understanding with explainable AI for trees*, Nature Machine Intelligence | TreeSHAP（木モデルの厳密・高速なSHAP） | LightGBM採用時の説明生成。多項式時間で厳密解 |
| Hastie & Tibshirani, Generalized Additive Models | 加法モデル。各項の効果がそのまま解釈できる | **v2のモデル構造そのもの**（後述） |

---

## 3. 目標アーキテクチャ（to-be）

### 3.1 レイヤー分離

```
[L1 データ取込]  外部要因コネクタ群 → ExternalFactorDaily（正規化済み特徴量）
                 PMS/OTA実績・ブッキングカーブ・競合価格
                        ↓
[L2 需要モデル]  D(date, price, features) → 価格別の予測需要（点 + 分位点）
                 打ち切り需要の復元 / pickup / 加法分解可能な構造
                        ↓
[L3 最適化]      40ランクを全探索し、目的関数を最大化 → 推奨ランク
                 目的関数に PricingStrategyConfig の重みが入る（P-2解消）
                        ↓
[L4 説明生成]    予測と最適化の過程を構造化した根拠レコードとして永続化
                 PriceRecommendationFactor（加法寄与） + 制約の発火記録
                        ↓
[L5 対話]        Claude API（tool use）が L4 のレコードとDBだけを根拠に回答
                 LLMは「説明を作る」のではなく「計算済みの根拠を翻訳する」
```

**L4 が本設計の要**。現行のように「LLMに数字を渡して理由を書かせる」設計にすると、それは事後の作文であり、実際の計算根拠とは無関係になる。L3 が根拠を出力し、L5 はそれを参照するだけ、という一方向の依存にする。

### 3.2 L2: 需要モデル — v2 は「加法モデル」を意図的に選ぶ

説明可能性が目玉機能である以上、**説明が近似ではなく厳密になるモデル構造**を選ぶ。

```
log(demand_d) = base_d
              + f_dow(曜日)
              + f_season(月/週)
              + f_lead(pickup: 残日数別の予約進捗の残差)
              + f_event(イベント規模)
              + f_holiday(祝日・連休長)
              + f_weather(天候)
              + f_compIndex(競合価格インデックス)
              + f_market(市場需要)
              + β_price * log(price_d / reference_price_d)     ← 価格弾力性
```

- 各項が独立した加算成分なので、**寄与の分解は定義上厳密**（SHAPの近似計算が不要）。
- 各項は単調性制約付きのスプライン or 区分線形で推定。データが薄い施設では項を落として縮退する。
- `β_price`（弾力性）は曜日帯 × 需要レベル別に推定。**素の回帰では P-5（内生性）で偏る**ため:
  1. 満室日を除外し、打ち切り補正（EM）後の需要を使う
  2. 競合価格・イベントを共変量として統制する
  3. それでも不足する場合は、低リスク日に**計画的な価格探索**（±1〜2ランクのランダム化）を行い、外生的な価格変動を作る（Besbes & Zeevi の考え方）
- 出力は点予測ではなく**分位点（10/50/90%）**。Conformal Prediction で被覆率を較正し、`confidence` を「予測区間の相対幅」として再定義する（P-7解消）。

v3で LightGBM に移行する場合も、**加法構造の出力インターフェース（因子別寄与のリスト）を変えない**。TreeSHAP が同じ形の寄与を返すため、L4/L5 は無改修で載る。これが移行コストを下げる最大の設計判断。

### 3.3 L3: 最適化 — 価格戦略の重みをここで効かせる

各日 `d` について、40ランクの候補価格 `p_r` を全探索する（40通り × 365日 = 探索空間は自明に小さい）。

```
E[Rooms(p_r)]   = min(D(d, p_r), 残室数)
E[Revenue(p_r)] = p_r * E[Rooms(p_r)]

score(r) = w_occ  * norm(E[Occupancy(p_r)])
         + w_adr  * norm(p_r)
         + w_comp * norm(-|p_r - CompetitorIndex_d|)
```

- `w_occ / w_adr / w_comp` は `PricingStrategyConfig` の値（合計100%）。**これで設定が実際に価格を動かす**（P-2解消）。
- 重み設定の意味を顧客に説明できるようにするため、UI上で「重みを変えたら推奨がどう動くか」の即時プレビューを出せる設計にする（最適化が軽いので同期実行可能）。
- ハード制約は最適化後にクリップし、**発火したことを根拠レコードに残す**:
  - 価格下限（`PriceRank` の最小ランク、パリティ制約）
  - 前日比の変動幅上限（急変防止）
  - 団体予約（`GroupBooking.revenueImpactRule`）による在庫控除
  - オペレーターの手動固定（F-DP-03 のリセット対象）
- LOS（P-8）は v3 で対応。イベント日の前後 ±1日を含む「滞在パターン単位」で評価し、単日の値上げが連泊予約を失わせないかを検査する。

### 3.4 L1: 外部要因の取り込み

現状の `Event`（手入力）と `DailyData.externalFactors`（自由記述）だけでは学習に使えないため、**日次で正規化された特徴量テーブル**を新設する。

提案スキーマ（`prisma/schema.prisma`、テナント分離ルール準拠）:

```prisma
model ExternalFactorDaily {
  id        String   @id @default(cuid())
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  hotelId   String
  hotel     Hotel    @relation(fields: [hotelId], references: [id], onDelete: Cascade)
  date      DateTime @db.Date
  category  String   // weather, holiday, market, fx, event, search, competitor
  key       String   // precipitation_mm, holiday_kind, inbound_index, jpy_usd ...
  value     Float?
  valueText String?
  source    String   // jma, cao, jnto, estat, manual, predicthq ...
  asOfDate  DateTime @db.Date  // いつ時点の情報か（予報の更新を追跡）
  reliability String?          // high, medium, low
  createdAt DateTime @default(now())

  @@unique([hotelId, date, category, key, asOfDate])
  @@index([tenantId])
  @@index([hotelId, date])
}
```

`asOfDate` が必須である理由: 天気予報も市場統計も**後から改訂される**。学習時に「予測日時点で入手できなかった値」を使うと、backtest だけ高精度になる典型的なリークが起きる。取込時点を保持し、学習・検証では常に as-of 時点の値のみを参照する。

取り込み候補（日本のホテル向け、コスト順）:

| 優先 | 要因 | ソース | 取得性 | 期待効果 |
|------|------|--------|--------|----------|
| 1 | 祝日・連休長・年末年始/GW/お盆 | 内閣府 祝日CSV（無料） | 容易 | 大。連休の「何日目か」は稼働に強く効く |
| 1 | 学校休暇期間 | 自治体カレンダー（手入力可） | 中 | ファミリー層の需要 |
| 1 | 競合価格・空室状況 | 既存 `CompetitorPriceData`（スクレイピング Phase 4） | 中 | 大。相対価格が予約選択を左右する |
| 1 | ブッキングカーブ / OTB | 既存 `BookingCurveData`（PMS連携） | 中 | **最大**。pickup 予測の必須入力 |
| 2 | 天候・警報 | 気象庁 API（無料） | 容易 | 中。当日〜3日前の直前需要、リゾート施設で特に大 |
| 2 | 地域イベント | 既存 `Event` + PredictHQ 等（有料） | 中 | 大。ただし規模の定量化（動員数）が必要 |
| 2 | 市場全体の需要 | 観光庁 宿泊旅行統計調査 / e-Stat（無料・月次・遅延あり） | 容易 | 中。自社不振が市場要因か自社要因かの切り分けに効く |
| 3 | 訪日外客数 | JNTO（無料・月次） | 容易 | インバウンド比率の高い施設で中〜大 |
| 3 | 為替 | 日銀 / 公開API（無料） | 容易 | インバウンド需要の先行指標 |
| 3 | 検索需要 | Google Trends（無料・相対値） | 中 | 先行指標。ノイズ大 |
| 4 | 交通（新幹線・航空の空席/運休） | 非公開が多い | 難 | 中 |

実装方針:
- コネクタは `backend/src/services/external/<source>.ts` に1ソース1ファイルで置き、共通の `ExternalFactorConnector` インターフェース（`fetch(hotel, dateRange) => ExternalFactorRecord[]`）に従わせる。
- **失敗はサイレントに握りつぶさない**。取得失敗はその要因を欠測として記録し、モデルはその項を落として予測する（`confidence` が下がる）。フロント規約（モックへのサイレントフォールバック禁止）と同じ原則を予測側にも適用する。
- API キー等は `src/lib/config.ts` 経由（`process.env` 直参照禁止のアーキテクチャ境界を維持）。
- 外部APIの障害・レート制限で価格計算全体が止まらないよう、取込（L1）と予測（L2）は非同期に分離し、L2 は DB の `ExternalFactorDaily` のみを読む。

### 3.5 モデル更新のライフサイクル

現状「オンデマンド再計算のみ・過去予測は上書き消滅」を、以下に置き換える。

| 頻度 | 処理 | 備考 |
|------|------|------|
| 日次（早朝） | 外部要因取込 → 実績同期 → 向こう365日を再予測 → 推奨価格更新 → アラート生成 | Phase 4 のバッチ基盤。冪等に設計し、再実行で同じ結果になること |
| 日次 | **予測スナップショット保存**（`ForecastSnapshot`: 宿泊日 × 予測実施日 × リードタイム） | P-6解消。これが無いと精度も改善も語れない |
| 週次 | 較正（conformal の分位点更新、直近誤差での bias 補正） | 再学習より軽く、季節変化に追随する |
| 月次 | 再学習 + backtest（rolling origin） + champion/challenger 比較 | 合格した場合のみ `MODEL_VERSION` を上げて昇格 |
| 常時 | 新モデルは shadow mode で並走（予測は保存するが価格は動かさない） | 本番投入前の安全弁 |

評価指標（Bertsimas & Kallus の指摘どおり、予測誤差だけでは不十分）:
- 予測精度: リードタイム別 WAPE / MAE（稼働率）、予測区間の被覆率
- 収益: RevPAR、予算達成率、**採用率**（AI推奨がそのまま採用された割合）と、手動上書き時の事後乖離
- 因果効果: 単一施設では通常のA/Bが組めないため、**switchback 実験**（週単位や日ブロック単位でAI推奨/従来運用を交互に割り当て）または類似日マッチングで uplift を推定する。「前年比で伸びた」は季節・市場要因と交絡するため根拠にしない。

---

## 4. 目玉機能: AIが根拠を答えるチャット

### 4.1 設計原則

> **LLMは根拠を「作らない」。根拠は価格エンジンが計算し、LLMはそれを日本語に翻訳し、追加質問に対してツール経由で事実を引く。**

これを守らないと、「なぜ8/15は高いのか」に対して LLM がもっともらしい理由（実際には計算に使われていない要因）を作文する。レベニュー担当者が意思決定に使う以上、根拠の正しさは機能要件そのもの。

### 4.2 根拠レコード（L4）

`AiPriceRecommendation` に紐づく子テーブルとして永続化する。

```prisma
model PriceRecommendationFactor {
  id               String   @id @default(cuid())
  tenantId         String
  tenant           Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  recommendationId String
  recommendation   AiPriceRecommendation @relation(fields: [recommendationId], references: [id], onDelete: Cascade)
  factorKey        String   // dow, season, event, weather, competitor, pickup, holiday, price_elasticity ...
  contribution     Float    // 稼働率換算のpt、または価格換算の円（単位は unit で明示）
  unit             String   // occupancy_pt, jpy, rank
  direction        String   // up, down, neutral
  evidence         Json     // 参照した実データ（値・比較対象・出典・as-of日）
  createdAt        DateTime @default(now())

  @@index([tenantId])
  @@index([recommendationId])
}
```

加えて、最適化段の記録として「発火した制約」「代替候補ランクとその期待収益」も保存する。これにより
「なぜ R28 で、R30 ではないのか」という**反実仮想の質問に、再計算なしで即答できる**。

想定される回答の骨格（すべて数値は L4 のレコードから引く）:

> 8/15（金）の推奨は R31（¥28,000）です。基準は直近4週の同曜日平均 72%。
> ここに ①近隣の花火大会（動員見込5万人、+12pt）②3連休の中日（+6pt）③競合5施設の平均が
> 前週比 +18%（+4pt）が加わり、予測稼働は 94%（80%予測区間 88〜98%）。
> R31 と R33 の期待収益差は 1.2% で、ADR重視の重み40%により R31 を選択しています。
> 前日比変動上限（+3ランク）に達したため、R33 は制約により除外されました。

### 4.3 チャット実装

- **Claude API（tool use）**。LLMに生データを大量に流し込むのではなく、read-only ツール群を定義して必要な分だけ引かせる:
  `getRecommendation(date)` / `getFactorBreakdown(date)` / `getBookingPace(date)` / `getCompetitorPrices(dateRange)` / `getActuals(dateRange)` / `getEvents(dateRange)` / `simulatePrice(date, rank)`（L3を再実行する what-if）
- **テナント分離は既存の仕組みを流用**: ツールは必ずサーバ側で JWT から解決した `hotelId` / `tenantId` でスコープする。LLMが指定した `hotelId` を信用しない（プロンプトインジェクション対策として必須）。
- **全ツール呼び出しを監査ログに記録**（`AuditLog`）。誰がどの日について何を尋ね、AIが何を根拠に答えたかを再現可能にする。
- **データが無いときは「無い」と答える**。欠測要因は L4 に欠測として残っているため、LLMは「競合価格が未取得のため、この日は競合要因を考慮していません」と正しく言える。ここでも「モックへのサイレントフォールバック禁止」を貫く。
- システムプロンプト + ホテル基本情報は **prompt caching** に載せる（日次バッチのAIコメント生成と併せてコスト最適化）。
- 出力は自由文だけでなく**構造化された引用（参照した date / factorKey / 値）**を返し、UIで該当セルにリンクさせる。これが「AIの説明を検証できる」という差別化の実体になる。
- F-DASH-06（AIまとめ）も同じ根拠レイヤーの上に載せる。ダッシュボードの要約とチャットの回答が食い違わないことが担保される。

---

## 5. 実装ロードマップ

| 段階 | 内容 | 前提 | 見返り |
|------|------|------|--------|
| **v1.5**（実装済み — `rule-based-v1.5`） | ①予測スナップショット保存（P-6: `ForecastSnapshot`）②祝日・連休補正（P-9の一部: `lib/jpHolidays.ts`）③`confidence` を80%予測区間ベースに再定義（P-7: 同曜日実績の分散から正規近似。conformal化はv2）④価格戦略の重みを推奨ランク選定に接続（P-2: `forecast/rankOptimizer.ts`、弾力性は暫定の仮定値 -0.8） | 現行データのみ | 「重みが効く」「精度を測れる」の2点だけで顧客説明力が大きく変わる |
| **v2** | pickup / ブッキングカーブ予測（P-3）＋打ち切り需要の復元（P-4）＋加法モデル化＋根拠レコード（L4）＋チャット（L5） | PMS/OTA連携（Phase 4） | 目玉機能が成立。ここが製品の核 |
| **v3** | LightGBM + TreeSHAP への差し替え、天候・市場・競合の本格投入、LOS対応（P-8） | 2年分程度の実績＋外部要因の蓄積 | 精度の実質的な向上 |
| **v4** | 計画的な価格探索（Thompson sampling 等）による弾力性の能動的学習（P-5） | 顧客の合意（意図的な価格変動を許容するか） | 弾力性推定の偏り解消。長期的な収益上限を引き上げる |

段階間の互換性は `DemandForecaster` インターフェース（`backend/src/services/forecast/types.ts`）で吸収する。ただし v2 で価格を入力に取るため、
`ForecastInput` に候補価格を渡せるよう拡張が必要（`forecast()` の返り値も分位点と因子寄与を含む形に拡張する）。この破壊的変更は v2 の着手時に一度で行う。

---

## 6. 未確定事項（クライアント確認が必要）

1. **PMS / サイトコントローラーの機種と連携方式**（ブッキングカーブの取得可否と粒度が v2 の成否を決める）
2. **意図的な価格探索を許容するか**（v4の前提。許容されない場合は弾力性推定の精度に上限が残ることを明示しておく）
3. **有料外部データ（イベント動員データ等）の予算**
4. **推奨価格の自動反映を行うか、承認フローを挟むか**（前者なら制約とアラートの設計が更に重要になる）
5. **説明の対象読者**（レベニューマネージャー向けか、経営層向けか。前者は数値の内訳、後者は結論と影響額を先に出す）

---

## 参考: 本書の位置づけ

本書は設計方針であり、実装は含まない。実装時は `AGENTS.md` の必須ルール（テナント分離・zodバリデーション・
アーキテクチャ境界・マイグレーション運用）に従うこと。特に外部データ取込は新規Prismaモデルを伴うため、
`tenantId` ＋ リレーション ＋ `@@index([tenantId])` の付与が必須。
