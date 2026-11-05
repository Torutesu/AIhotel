# PMS／サイトコントローラー連携 設計（PC USE 方式）

Phase 4 のうち「PMS／サイトコントローラー連携」の方式を確定したもの。
`docs/改善計画.md` の「次のアクション 4. Phase 4 の仕様確定」に対応する。

**本ドキュメントは設計の確定であり、実装はまだ無い。** レベスト側に必要な追加実装は §6 に列挙した。
実装状況を報告するときは `要件定義書.md` §6 の表を正とすること。

## 1. 決定事項

NEHOPS（PMS・NEC製）と TL-リンカーン（サイトコントローラー）に API 連携の口が無いため、
**画面操作（PC USE）で連携する**。画面操作の基盤には OSS の
[agent-desktop](https://github.com/vercel-labs/agent-desktop)（Apache-2.0）を使う。

構成は **ハイブリッド**とする。

| 工程 | 実行場所 | 構成 |
|---|---|---|
| 手順の作成・画面変更時の修復 | 当社環境（または検証環境） | Claude Code ＋ agent-desktop で手順を書き起こす。ツール制限なし |
| 日々の運用 | 顧客端末 | Claude Code ＋ agent-desktop。**許可ツールを agent-desktop の画面操作だけに絞る**。確定済み手順を実行し、要素が見つからなければ停止・通知 |

運用側でも Claude Code 本体を使う。顧客端末に汎用の開発環境を置かないのではなく、
**権限設定で開発に使える道具を取り上げる**ことで担保する（§5.1）。
この形にする理由は、エージェントループ・公式スキル・回復手段を自前で再実装しないこと、
および手順作成と運用で同じ基盤を使えること。

## 2. この形を採った理由

精度の高い構成は工程によって変わる。

- **手順の作成・修復**はコーディングエージェントが有利。失敗出力を読んで方針を変える動作が作り込まれており、
  `trace`、再スナップショット、中間 JSON の確認といった回復手段が全部使える。
  agent-desktop はバイナリのバージョンに合ったスキル（`agent-desktop skills get desktop`）を配っており、
  ref の扱いや `STALE_REF` の復帰といった事故りやすい部分がそこに書かれている。
- **日々の運用**は裁量を削るほど有利。運用は決まった手順の実行であり、AI の裁量が増えるほど
  「余計なことをする」失敗モードが増える。

当初は運用側を自社アプリにする案も検討したが、Claude Code の権限設定が
プロンプトでの依頼ではなく**構造的な制約**として効くことを確認したため、運用側も Claude Code とした。
根拠は §5.1。

## 3. 処理の 4 段

1. **取り込み** — NEHOPS から日別実績をファイル出力（参照のみ。書き込みなし）
2. **算出** — レベストで集計し料金ランクを算出
3. **承認** — 顧客のレベニュー担当者が日次で承認（ここを通らないと 4 に進まない）
4. **反映** — 承認済みの料金ランクのみを TL-リンカーンへ入力（限定範囲の書き込み）

```
[顧客端末] NEHOPS ──参照・出力──> ローカル固定フォルダ
                                      │ HTTPS
                                      v
[当社]                            レベスト（集計・ランク算出・ガードレール）
                                      │
                                      v
                                  料金ランク案を画面表示 ──> 人が日次で承認
                                      │
                                      v  HTTPS
[顧客端末] TL-リンカーン <──料金ランク欄のみ入力──  Claude Code + agent-desktop
                                      │
                                      v
                                  入力後に同画面を読み返して一致確認 → 監査ログ
```

AI サービスへ送るのは画面部品の構造情報（項目名・ラベル・入力欄の種別・位置・ボタン名）のみ。
スクリーンショット、実績データ、認証情報は送らない。

## 4. 役割分担

- **AI（Claude Code）** — 画面上のどこに何があるかの判別と、所定の画面操作の実行。判断を伴う処理はしない
- **AI が構造上できないこと** — シェル実行、ファイル作成・編集、Web 取得・検索（§5.1 で deny。ツールごと消える）
- **プログラム（レベスト）** — 集計、稼働率／ADR／RevPAR の算出、料金ランクの算出、ガードレール判定、監査ログ記録
- **人** — 日次の承認、例外時の判断、月次の運用レビュー
- **やらせないこと** — 価格の決定、承認、削除・上書きの判断、権限・設定の変更、承認を経ない反映

## 5. ガードレール

### 5.1 Claude Code の権限設定で担保する

公式ドキュメントで確認した挙動（`code.claude.com/docs/en/permissions`、`.../settings`、`.../env-vars`）。

| 設定 | 効果 |
|---|---|
| `permissions.deny` に**素のツール名**を書く | そのツールが Claude に渡される情報から取り除かれ、AI からは存在しなくなる（「A bare tool name like `Bash` removes the tool from Claude's context entirely, so Claude never sees it」）。`Bash` / `Write` / `Edit` / `WebFetch` / `WebSearch` をこれで消す |
| `permissions.allow` に `mcp__agent-desktop__*` | agent-desktop のツールのみ自動承認。allow の glob は `mcp__<server>__` 接頭辞の後ろにしか書けないため、サーバを特定した許可になる |
| `permissions.defaultMode` を `dontAsk` | 許可されていない操作は確認を求めず**拒否**される。無人実行で人の判断を待って止まらない |
| `permissions.blockReadsOutsideWorkingDirectories` / `...blockWritesOutsideWorkingDirectories` を `true` | 作業ディレクトリ外のパスを全権限モードで拒否。`bypassPermissions` でも効き、どのスコープの `true` も優先される |
| `permissions.disableBypassPermissionsMode` を `"disable"` | 権限確認を省略するモードを使えなくする |
| `env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | 自動更新・利用統計・エラー報告・フィーチャーフラグ取得を止める |
| managed settings（`managed-settings.json` / MDM） | 顧客の情報システム部門が配布すれば、当社側の設定では上書きできない |

重要な順序の注意: **deny → ask → allow の順で評価され、allow は deny の例外を作れない。**
したがって `deny: ["*"]` ＋ `allow: ["mcp__agent-desktop__*"]` は成立しない（全部拒否になる）。
消したいツールを個別に列挙すること。

`PreToolUse` フックでの追加検査も可能だが、フックの `allow` は deny ルールを覆せないため、
あくまで deny の上積みとして使う。

### 5.2 プログラム側で担保する

| 項目 | 内容 | 既存の拠り所 |
|---|---|---|
| 未登録ランクを出さない | 算出結果が `PriceRank`（`hotelId` 単位、`isActive` のもの）に無いランクなら出力しない | `PriceRank`（rank 1〜40、`@@unique([hotelId, rank])`） |
| 変更幅の上限 | 前日比の変更幅が設定上限を超えたら出力せず警告 | 新規実装（§6） |
| 対象日数の一致 | 取得件数が対象日数と一致しない場合は停止 | 新規実装（§6） |
| 承認の記録 | 承認者と承認時刻が無い料金ランクは反映しない | 新規実装（§6） |
| 読み返し確認 | 入力後に同画面を読み返し、承認値と完全一致しなければ即停止 | 操作手順側 |
| 変更前後の記録 | 反映の変更前／変更後の値を全件記録 | `AuditLog`（`oldValue` / `newValue` がそのまま使える） |
| 操作対象の限定 | 操作可能な画面・項目をホワイトリストで固定。更新系ボタンは対象に含めない | 操作手順側＋§5.1 |
| 接続先の限定 | レベストと Claude API（api.anthropic.com）の 2 系統のみ | §5.1（WebFetch / WebSearch を deny）|

`AuditLog` は `action` / `entity` / `entityId` / `oldValue` / `newValue` / `userId` を持つため、
承認と反映の記録にそのまま使える。新しいログ基盤は作らない。

## 6. レベスト側に必要な追加実装（未実装）

1. **取り込み API** — 現在 `backend/src/routes/` に取り込み系のエンドポイントは 1 つも無い。
   日別実績を受け取る `POST /api/v1/ingest/daily` 相当が必要。
   `authenticate` ＋ `requireHotelAccess` ＋ `requireRole('ADMIN','MANAGER')` ＋ `writeAuditLog()` を適用し、
   入力は `backend/src/lib/validators.ts` の zod スキーマで検証する。
   送信項目は一覧で固定し、一覧外の列が含まれていたら受け付けずエラーを返す。
2. **承認状態** — `AiPriceRecommendation` に承認の状態が無い（`recommendedRank` などの算出結果だけを持つ）。
   承認ステータス、承認者、承認時刻、反映結果を持たせる必要がある。
   **このモデルを変更するときは、部分ユニーク索引
   `AiPriceRecommendation_hotelId_date_null_roomtype_key` が残っているか必ず確認すること**
   （`roomTypeId IS NULL` の重複を防いでいる手書き索引。schema.prisma では表現できない / C-4）。
3. **ガードレール設定** — 変更幅の上限値を施設ごとに持つ場所が無い。`Hotel` か
   `PricingStrategyConfig` のいずれかに置く（要決定）。
4. **反映結果の受け取り** — 顧客端末から「反映した・失敗した」を受けて記録するエンドポイント。
5. **実行履歴画面** — 当日の実行結果（開始終了時刻、対象日数、承認者、変更前後の値）の一覧。

いずれも `prisma migrate dev` でマイグレーションを生成してコミットする（`db:push` は使わない）。

## 7. agent-desktop の採用条件

- **バージョンを固定する。** v0.10.0 で C ABI major 5、ref 形式（スナップショット修飾が必須化）、
  `--snapshot` 削除などの破壊的変更が入っている。envelope は 2.6。
  最新は v1.2.0（2026-11-05）で、`agent-desktop mcp` はこのリリースで入ったばかり。
  本番は自社で検証したバイナリをバージョン固定で配布し、自動更新しない。
- **統合は MCP サーバとして。** `agent-desktop mcp` が全コマンドを MCP ツールとして stdio で公開する
  （v1.2.0 で追加）。Claude Code の `mcpServers` に登録し、`mcp__agent-desktop__*` を allow する。
  `libagent_desktop_ffi`（C ABI）も同梱されているが、本構成では使わない。
- **読み取りは既定で headless。** ポインタを動かさずフォーカスも奪わないため、
  朝の実行が人の作業を邪魔しない。これが本件で agent-desktop を選ぶ実利。
- **既知の制約**（着手時に再確認する）
  - 背景の Chromium / Electron への入力が効かず `--headed` が必要になる場合がある（issue #395）。
    TL-リンカーンがブラウザ経由のため、書き込み工程に影響する可能性がある。headed はフォーカスを奪う。
  - Windows ARM64 で UIA スナップショット後に combase.dll でアクセス違反（issue #417）。
    顧客端末が x64 なら無関係。端末の CPU を確認する。

## 8. 着手前の判定

**精度の上限は NEHOPS のアクセシビリティツリーに項目が出るかどうかで決まる。**
ツリーが薄ければ構成をどう組んでも成立しないため、他の作業より先にここを確認する。

顧客端末で 1 回流す:

```
agent-desktop list-apps
agent-desktop snapshot --app <NEHOPSのアプリ名> --compact
```

- **続行可** — 実績照会画面の入力欄・ボタン・表の項目が名前付きで列挙される
- **設計やり直し** — 要素が出てこない、ウィンドウ 1 枚だけが返る、名前が空
  （古い Win32 やカスタム描画で UI Automation に項目が出ていない）

TL-リンカーンについても同じ確認を行い、料金ランク欄が項目として取れるかを見る。

## 9. 未確定事項

- NEHOPS の実績照会画面の正式名称、出力形式、文字コード（NEC 社への確認事項）
- 参照権限のみのロールを NEHOPS 側で設定できるか（NEC 社への確認事項）
- 検証環境の有無。無い場合、手順の初回作成を顧客端末で立ち会いのもと一度だけ行う形にする
- 実行時刻（NEHOPS の日締め処理と重ならない時刻）
- 対象施設数
- 監査ログの保存期間（90 日を標準として提示している）
- 使用する AI サービス（選定中。学習への不使用・保存期間・処理リージョンを必須条件とする）
