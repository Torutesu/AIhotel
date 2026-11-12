# video — ローンチ動画・シーン別の説明動画

実アプリの画面を撮影し、絵コンテ（コード）からカメラワーク・ハイライト・字幕を付けて MP4 にする仕組み。
画面や文言が変わったら、撮り直してレンダリングし直すだけで動画を更新できる。

| 動画 | 絵コンテ | 長さ | 内容 |
|---|---|---|---|
| ローンチ動画 | `storyboards/launch.js` | 約93秒 | 課題 → レブスト → 4つの画面 → 土台（テナント分離・権限・監査ログ）→ ロゴ |
| 01 ダッシュボード | `storyboards/scene-01-dashboard.js` | 約71秒 | アラート・AI解説・稼働/ADR月間推移・月初/日付比較・KPI進捗・在庫表 |
| 02 ダイナミックプライシング | `storyboards/scene-02-pricing.js` | 約81秒 | 着地予測・日別価格カレンダー・日のAI分析・シミュレーション・オンハンド状況 |
| 03 分析 | `storyboards/scene-03-analysis.js` | 約78秒 | 実績推移・需要構成・予約動向・競合比較 |
| 04 外部需要動向 | `storyboards/scene-04-external.js` | 約49秒 | 需要指数・要因の一覧・イベント登録と CSV 取り込み・特殊日 |
| 05 レポート | `storyboards/scene-05-reports.js` | 約35秒 | 月次レポートの PDF / Excel 出力 |
| 06 設定 | `storyboards/scene-06-settings.js` | 約81秒 | 週末定義・料金ランク・重み付け・予算・CSV 取り込み・ユーザー・監査ログ |

字幕とナレーション原稿の一覧は [`SCRIPT.md`](./SCRIPT.md)。

## 作り方

前提: frontend（:3000）と backend（:3001）が seed 済みの DB で起動していること（ルートの `AGENTS.md` のコマンド）。
着地予測やアラートを出すため、撮影の前に `pnpm --filter backend job:daily` を1回流す。
`ffmpeg`・`pdftoppm`（poppler）と Playwright の Chromium、日本語フォント（Noto Sans CJK JP）が必要。

```bash
node video/capture.mjs            # 1. 実アプリを操作して素材を撮る → video/captures/
node video/render.mjs             # 2. 全動画をレンダリング → video/out/*.mp4（+ .srt・サムネイル .jpg）
node video/render.mjs --script    # 3. 字幕・ナレーション原稿を SCRIPT.md に書き出す
```

よく使う指定:

```bash
node video/render.mjs launch                    # 1本だけ
node video/render.mjs launch --still 12,40.5    # 指定した秒の静止画だけ（out/stills/。構図の確認用）
node video/render.mjs --no-audio                # BGM なし（別の音源・ナレーションを重ねるとき）
node video/capture.mjs pricing                  # id が前方一致するショットだけ撮り直す
```

ブラウザでのプレビュー: `video/` を静的サーバーで配信して `player/index.html?id=launch` を開く（再生・シークができる）。

`captures/` と `out/` は生成物なのでコミットしない（`.gitignore` 済み）。

## 構成

- `shots.mjs` — 撮る画面（ショット）と、絵コンテから名前で参照する領域の定義
- `capture.mjs` — ショットを順に撮る。本文は全長（2倍解像度のタイル）、ダイアログは中身の全長、月次レポートは実際の PDF の1ページ目も取得する
- `player/` — 構成エンジン。`seek(t)` で時刻 t の画面を決定的に描く（CSS アニメーション不使用）
- `storyboards/*.js` — 絵コンテ。クリップ（`title` / `statement` / `pains` / `app` / `cards` / `logo`）の並び
- `render.mjs` — 1フレームずつ `seek` → スクリーンショット → ffmpeg（1920×1080・30fps・H.264）
- `audio.mjs` — BGM をコードで合成する（外部の音源・ライセンス素材なし）

### 絵コンテの書き方（`app` クリップ）

`beats` を上から順に再生する。1ビート = カメラが落ち着く1カット。

```js
{ dur: 6,                    // 秒
  shot: 'pricing',           // 切り替えるショット（省略すると前のまま）
  dialog: 'pricing-day',     // 開くダイアログ（null で閉じる）
  focus: 'landing',          // 寄せる領域。'full' / 'dialog' / 'dlg:sim'（ダイアログ内）/ { region, pad, maxZoom, pan }
  highlight: true,           // 囲む領域（true は focus と同じ）
  label: '着地予測',          // 囲みに付けるラベル
  cursor: 'row', click: true, // カーソルを動かす先と、ビートの終わりのクリック
  tag: '<b>2/7</b>着地予測',  // 右上の進行表示
  note: '※ サンプル表示です',  // 注記（サンプル表示の欄を映すときは必ず付ける）
  caption: '字幕',            // 画面下の字幕（<em> で強調）
  narration: '読み原稿',      // 字幕と違う文面で読むとき
  side: { k, t, d } }        // 左にコピーを置くレイアウト（ローンチ動画）
```

## 表現のルール

- **未実装の機能を実装済みのように見せない**（`AGENTS.md`「未実装領域」）。サンプル表示の欄を映すビートには `note` で明示する
- 画面は seed のデモデータ（デモホテル東京）。実在の顧客データで撮らない
- 文言は画面・要件定義書 §6 の実装状況に合わせる。機能を変えたら絵コンテの字幕も見直す

## ナレーション・BGM を差し替える

```bash
node video/render.mjs launch --no-audio
ffmpeg -i video/out/launch.mp4 -i narration.wav -i bgm.mp3 \
  -filter_complex "[2:a]volume=0.25[b];[1:a][b]amix=inputs=2:duration=first[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac video/out/launch-narrated.mp4
```
