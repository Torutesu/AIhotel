# 現地端末で動かす取得ツール（IP制限があるため端末側で実行する — #6）

TL-リンカーンにIP制限があり、ホテルの端末・ホテルのネットワークからしかアクセスできない前提。
そのため取得処理も**その端末の上で動かす**。ここには端末で使う道具を置く。

業務用PCなので、置ける／動かせるものが限られる。**確認できた条件に応じて上から選ぶ**。

| 優先 | 方式 | 端末に必要なもの | 判断の材料 |
|------|------|----------------|-----------|
| 1 | **PowerShellでHTTPリクエストを再現** | なし（Windows標準） | 現地で取ったHARを見て、エクスポートが素直なリクエスト1本なら成立。いちばん軽く壊れにくい |
| 2 | **携帯版Playwright（USBから実行）** | USBのフォルダ一式（インストーラ不要・管理者権限不要） | USBからの実行が許可されているか。`Setup-PortablePlaywright.ps1` で事前に作る |
| 3 | **Power Automate Desktop** | Windows 11なら標準搭載 | 1・2が使えない場合。GUIでフローを組む（手作業が増える） |
| 4 | LLMのコンピュータ操作 | Python等の実行環境＋外部APIへの通信 | 定期実行には使わない。開発時の調査補助まで |

どの方式でも、落としたCSVの送り先は既存の取込APIで共通（`tools/field-test/Send-ReservationCsv.ps1`）。

## 現地で最初に確認する4点（方式が決まる）

1. **端末から自社APIへHTTPSで出られるか** — 出られなければ、そもそも継続送信が成立しない（プロキシ設定・許可申請の対象を特定する）
2. **USBから実行ファイルを起動できるか** — AppLocker等で止められていないか
3. **PowerShellの実行ポリシー** — `powershell -ExecutionPolicy Bypass -File` が通るか
4. **タスクスケジューラに登録できるか** — 無人実行の前提

## 1. PowerShellでリクエスト再現（HAR待ち）

HARを見てから書く。組み立てに必要な情報は次の5つ。

- ログインのリクエスト（URL・メソッド・パラメータ・CSRFトークンの出所）
- セッションの持ち方（Cookie名）
- エクスポートのリクエスト（URL・パラメータ、とくに期間指定の形式）
- レスポンスがCSV本体か、生成後に別URLからダウンロードする形か
- 文字コード（Shift_JIS想定）

`Invoke-WebRequest -SessionVariable` でCookieを保持すれば、Windows標準のまま実装できる。

## 2. 携帯版Playwrightの作り方（事前準備・要インターネット）

**自分のWindows PCで1回だけ実行**して、USBにキットを作る。ホテル端末では何もインストールしない。

```powershell
# 例: USBドライブ E: に作る
.\Setup-PortablePlaywright.ps1 -KitPath E:\tl-kit
```

できあがる構成:

```
E:\tl-kit\
  node\            … 携帯版Node.js（インストーラ不要）
  browsers\        … Playwrightのブラウザ（PLAYWRIGHT_BROWSERS_PATH に指定）
  node_modules\
  export-tl.mjs    … 取得スクリプト（セレクタは selectors.json から読む）
  selectors.json   … 現地で埋める
  codegen.cmd      … 操作を記録してコードにする
  run.cmd          … 取得を実行する
```

現地での使い方:

```
E:\tl-kit\codegen.cmd https://<TLのURL>     ← 操作を記録してセレクタを拾う
（selectors.json を埋める）
E:\tl-kit\run.cmd                            ← 取得を実行（CSVが out\ に落ちる）
```

`run.cmd` は失敗するとスクリーンショットと trace を `out\` に残す。原因調査はそれを持ち帰って行う。

## 3. 無人実行（タスクスケジューラに登録するのは1本だけ）

```
powershell -ExecutionPolicy Bypass -File .\Invoke-Pipeline.ps1 `
  -KitPath C:\hotel-import\tl-kit -Endpoint https://api.example.com `
  -Email import@example.com -HotelId <hotelId> -Days 30
```

`Invoke-Pipeline.ps1` が「取得 → 送信」を続けて行い、どちらかが失敗すれば終了コード1で終わる
（スケジューラに失敗が残る）。取得が失敗したときは送信に進まない ―― 古いCSVを送って
成功に見せないため。`TL_USER` / `TL_PASSWORD` はタスクの実行ユーザー環境に設定しておく。

## 4. 取得後の流れ（既存）

```
CSV → Send-ReservationCsv.ps1 → POST /api/v1/import/reservations → DB → 画面
                                  ↑ 列マッピングはサーバ側に保存済み
```

日次バッチが「前日分が入っていない」「一定時間取込が成功していない」を検知してアラートを出す。
RPAは画面変更で黙って壊れるため、**この検知を有効にしてから常用に入る**。

## 注意

- 操作は参照とエクスポートに限る。在庫・料金・プランの更新系には触らせない
- 認証情報はスクリプトに書かない（環境変数か、DPAPIで暗号化したファイル）
- HAR・trace・スクリーンショットにはセッショントークンや宿泊者名が入る。リポジトリにコミットしない
- 自動操作の規約上の扱いは別途確認する（シーナッツ社／ホテル）
