# 当日手順（Windows・現地端末での実行）

2026-09-15 / NEHOPS × TL-リンカーン。IP制限があるため取得はホテルの端末上で行う。
コマンドはすべて**管理者権限なし**で動く想定。インストーラは使わない。

所要の目安: 出発前20分 → 現地フェーズ1（環境確認）10分 → フェーズ2（手動1サイクル＋記録）30分
→ フェーズ3（取込まで）20分 → フェーズ4（自動化を1回無人で）30分 → 撤収10分

---

## 出発前（自分のWindows PCで・要インターネット）

### 1. USBキットを作る

```powershell
# リポジトリを取得（またはtools/配下だけコピー）
git clone -b claude/vibrant-curie-9h9l56 https://github.com/Torutesu/AIhotel.git
cd AIhotel\tools\rpa

# USB（例: E:）にキットを作る。Node.jsのzip版とChromiumがE:\tl-kit配下に入る
.\Setup-PortablePlaywright.ps1 -KitPath E:\tl-kit
```

### 2. USBから実行するファイルのブロックを解除しておく

インターネット由来のファイルはSmartScreenで警告が出る。**現地で慌てないよう先に外す**。

```powershell
Get-ChildItem -Path E:\tl-kit -Recurse -File | Unblock-File
```

### 3. 動作確認（ガードで止まるのが正常）

```powershell
E:\tl-kit\run.cmd
# → {"status":"failed","error":"環境変数 TL_USER / TL_PASSWORD を設定してください..."}
#   このメッセージが出れば、Node・Playwrightの導線は通っている
```

### 4. USBに入れるもの

- `E:\tl-kit\` 一式（キット）
- `tools\field-test\Send-ReservationCsv.ps1`、`Inspect-ReservationCsv.ps1`
- `tools\rpa\Invoke-Pipeline.ps1`
- 空フォルダ `E:\capture\`（HAR・HTML・録画・CSVの置き場）
- この手順書と `docs\現地テスト_2026-09-15_NEHOPS_TLリンカーン.md`（記録欄）

### 5. 送信先を起動しておく（持参PC）

```bash
docker compose -f docker/docker-compose.dev.yml up -d
pnpm --filter backend db:generate
pnpm --filter backend db:migrate && pnpm --filter backend db:seed
pnpm --filter backend dev      # 0.0.0.0:3001
```

持参PCのIPを確認し（`ipconfig`）、ファイアウォールで3001の受信を許可しておく。

---

## フェーズ1: 環境確認（現地・10分）

ホテル端末でPowerShellを開き（スタート → `PowerShell`、管理者権限は不要）、上から順に。
**ここの結果で今日やれることが決まる。**

```powershell
# 1. Windows と PowerShell のバージョン
[System.Environment]::OSVersion.Version; $PSVersionTable.PSVersion

# 2. 実行ポリシー（Bypassで回避できるか。GPOでRestrictedだと -Bypass も拒否される）
Get-ExecutionPolicy -List

# 3. 自社APIへ到達できるか ← 最重要。出られないと継続送信が成立しない
Invoke-RestMethod http://<持参PCのIP>:3001/health | ConvertTo-Json -Compress

# 4. プロキシ設定（3が失敗したとき、何が要るかを特定する）
netsh winhttp show proxy
Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' |
  Select-Object ProxyEnable, ProxyServer, AutoConfigURL

# 5. USBから実行できるか（AppLocker等で止められていないか）
E:\tl-kit\node\node.exe -v

# 6. タスクスケジューラに登録できるか（テストタスクを作って消す）
schtasks /Create /TN "hotel-import-test" /SC ONCE /ST 23:59 /F /TR "cmd /c exit 0"
schtasks /Run /TN "hotel-import-test"
schtasks /Query /TN "hotel-import-test" /V /FO LIST | Select-String "前回の結果","Last Result"
schtasks /Delete /TN "hotel-import-test" /F

# 7. Power Automate Desktop の有無（5・6がダメだった場合の代替）
Test-Path "C:\Program Files (x86)\Power Automate Desktop"
Get-AppxPackage *PowerAutomate* | Select-Object Name, Version

# 8. 電源・スリープ設定（無人実行の可否に直結）
powercfg /query SCHEME_CURRENT SUB_SLEEP | Select-String "STANDBYIDLE" -Context 0,4
```

判定:

| 結果 | 今日やること |
|------|------------|
| 3がOK・5がOK・6がOK | フルコース（フェーズ4まで） |
| 3がOK・5がNG | フェーズ2〜3（手動1サイクル＋記録）。自動化はHAR解析かPADで後日 |
| 3がNG | フェーズ2（記録）に集中し、**許可申請の対象（宛先・ポート・プロキシ）を特定して持ち帰る** |

---

## フェーズ2: 手動1サイクル＋記録（30分）

### 2-1. 1回目は観察（記録なし）

ブラウザでTL-リンカーンにログイン（**ブックマークか施設が普段使うURLから**。検索結果から入らない）。
予約検索 → 期間指定 → CSVエクスポートまでを通し、流れと画面名を把握する。

### 2-2. 2回目を記録しながら

```
1. 画面録画を開始      Win + Alt + R（Xbox Game Bar）
2. DevToolsを開く      F12 → Network タブ
3. 「Preserve log」に✓（ページ遷移でログが消えないように）
4. ログインからCSVエクスポートまでを実行
5. Network の一覧で右クリック → Save all as HAR with content
   → E:\capture\tl_export.har に保存
6. 予約検索・出力条件の画面で Ctrl+S →「Webページ、完全」→ E:\capture\
7. 録画を停止（Win + Alt + R）
```

### 2-3. 落ちたCSVの列を確認

```powershell
powershell -ExecutionPolicy Bypass -File E:\tl-kit\Inspect-ReservationCsv.ps1 `
  -Path "$env:USERPROFILE\Downloads\<落ちたファイル名>.csv" -OutDir E:\capture

# 個人情報列を落としたコピーを作る（持ち帰るのはこちらだけ）
powershell -ExecutionPolicy Bypass -File E:\tl-kit\Inspect-ReservationCsv.ps1 `
  -Path "$env:USERPROFILE\Downloads\<落ちたファイル名>.csv" -OutDir E:\capture `
  -DropColumns 宿泊者名,電話番号,メールアドレス
```

出力された調査レポートで、**予約受付日（A2）・取消日／ステータス（A3）・団体区分（A4）・販売先（A6）**
の列があるかを確認し、記録欄に転記する。

---

## フェーズ3: 取込まで通す（20分）

### 3-1. 列マッピングを登録（持参PCから1回だけ）

```powershell
$body = @{
  hotelId = '<hotelId>'; source = 'tl-lincoln'; encoding = 'cp932'; delimiter = ','
  mapping = @{
    checkInDate = 'チェックイン'; nights = '泊数'; rooms = '室数'; guests = '人数'
    revenue = '合計金額'; revenueScope = 'per-stay'; bookedAt = '予約受付日'
    cancelledAt = '取消日'; status = 'ステータス'; cancelStatusValues = @('取消')
    channel = '販売先'; roomTypeCode = '室タイプコード'
  }
} | ConvertTo-Json -Depth 5

$login = Invoke-RestMethod -Uri 'http://localhost:3001/api/v1/auth/login' -Method Post `
  -ContentType 'application/json' -Body '{"email":"<管理者メール>","password":"<パスワード>"}'
$token = $login.data.tokens.accessToken

Invoke-RestMethod -Uri 'http://localhost:3001/api/v1/import/mapping' -Method Put `
  -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' -Body $body
```

列名はフェーズ2の調査結果に合わせて直す。手元で確かめるだけなら DB不要のCLIも使える:

```bash
pnpm --filter backend import:reservations -- --file ./予約明細.csv --inspect
```

### 3-2. 端末から送信（まずdry-run）

```powershell
# 初回のみ: 取込用アカウントのパスワードを暗号化して保存
powershell -ExecutionPolicy Bypass -File E:\tl-kit\Send-ReservationCsv.ps1 `
  -SavePassword -CredentialPath E:\tl-kit\cred.txt

# dry-run（書き込まない疎通確認）
powershell -ExecutionPolicy Bypass -File E:\tl-kit\Send-ReservationCsv.ps1 `
  -Endpoint http://<持参PCのIP>:3001 -Email <取込用アカウント> -CredentialPath E:\tl-kit\cred.txt `
  -HotelId <hotelId> -CsvPath E:\capture\<個人情報除去済み>.csv -DryRun

# 本番送信
powershell -ExecutionPolicy Bypass -File E:\tl-kit\Send-ReservationCsv.ps1 `
  -Endpoint http://<持参PCのIP>:3001 -Email <取込用アカウント> -CredentialPath E:\tl-kit\cred.txt `
  -HotelId <hotelId> -CsvPath E:\capture\<個人情報除去済み>.csv
```

持参PCの画面でダッシュボード・日別実績・ブッキングカーブが実データになることを確認する。
履歴も見る: `GET http://localhost:3001/api/v1/import/runs?hotelId=<hotelId>`

---

## フェーズ4: 自動化を1回無人で（30分）

### 4-1. セレクタを拾う（この端末でやる。IP制限があるので自分のPCでは再現できない）

```
E:\tl-kit\codegen.cmd https://<TLのURL>
```

開いたブラウザで実際に操作すると、左のウィンドウにコードが出る。そこから
ログイン欄・ボタン・期間入力・エクスポートボタンのセレクタを `E:\tl-kit\selectors.json` に書く。
`out\storage.json` と `out\codegen-trace.zip` も残るので持ち帰る（**セッション情報が入るので扱い注意**）。

### 4-2. 取得を1回試す（画面を見ながら）

```powershell
$env:TL_USER = '<TLのログインID>'
$env:TL_PASSWORD = Read-Host -AsSecureString | ForEach-Object {
  [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($_)) }

E:\tl-kit\run.cmd --days 30 --headed
# 成功: {"status":"success","file":"...out\tl_export_*.csv","bytes":...,"columns":...}
# 失敗: out\error_*.png と out\error-trace_*.zip を見る（持ち帰って解析する）
```

### 4-3. 取得→送信を1本で通す

```powershell
# 初回のみ: TLのパスワードを暗号化して保存（環境変数に平文を残さないため）
powershell -ExecutionPolicy Bypass -File E:\tl-kit\Invoke-Pipeline.ps1 `
  -SaveTlPassword -TlCredentialPath E:\tl-kit\tl-cred.txt

powershell -ExecutionPolicy Bypass -File E:\tl-kit\Invoke-Pipeline.ps1 `
  -KitPath E:\tl-kit -Endpoint http://<持参PCのIP>:3001 `
  -Email <取込用アカウント> -HotelId <hotelId> `
  -TlUser <TLのログインID> -TlCredentialPath E:\tl-kit\tl-cred.txt -Days 30
```

### 4-4. タスクスケジューラに登録（引数が長いのでラッパーを作る）

```powershell
# ラッパー .cmd を作る（schtasks の引用符地獄を避ける）
@"
@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File E:\tl-kit\Invoke-Pipeline.ps1 ^
  -KitPath E:\tl-kit -Endpoint http://<持参PCのIP>:3001 ^
  -Email <取込用アカウント> -HotelId <hotelId> ^
  -TlUser <TLのログインID> -TlCredentialPath E:\tl-kit\tl-cred.txt -Days 30
"@ | Set-Content -LiteralPath E:\tl-kit\daily.cmd -Encoding ASCII

# 毎朝6:30に実行するタスクを登録
schtasks /Create /TN "HotelImport" /SC DAILY /ST 06:30 /RL LIMITED /F /TR "E:\tl-kit\daily.cmd"

# その場で1回、人が触らずに動くことを確認する
schtasks /Run /TN "HotelImport"
schtasks /Query /TN "HotelImport" /V /FO LIST | Select-String "前回の結果","Last Result"
Get-Content E:\tl-kit\logs\pipeline-*.log -Tail 5
```

確認する3点: **タスクの前回の結果が 0 / ログに成功行 / `GET /import/runs` に履歴**。

### 4-5. 耐性の確認

```powershell
# 画面ロック中でも動くか（Win+L でロックしてから、別途 /Run させて結果を見る）
# サインアウト状態でも動かすには「ユーザーがログオンしているかどうかに関わらず実行する」が必要
#   → タスクスケジューラGUIで設定できるか確認（パスワード保存を求められる）
# スリープ設定（フェーズ1の8）と、実行時刻が営業時間内かを確認
```

---

## 撤収（10分）

```powershell
# 端末に残したものを記録する（あとで回収・整理できるように）
Get-ChildItem E:\tl-kit -Recurse -File | Select-Object FullName, Length | Out-File E:\capture\残置物一覧.txt
schtasks /Query /TN "HotelImport" /V /FO LIST | Out-File E:\capture\タスク設定.txt
```

- タスクを**残す**（翌朝2日連続で入るかを見る）か、**消す**（`schtasks /Delete /TN "HotelImport" /F`）かを決める
- 持ち帰り物の確認: HAR・画面HTML・録画・個人情報除去済みCSV・`out\` のtrace・調査レポート
- **持ち出す前に中身を確認**: HAR・storage.json・traceにはセッショントークンが、CSV・スクショには宿泊者名が入りうる
- `cred.txt` / `tl-cred.txt` は端末に残す（DPAPIで他端末では復号できない）。運用しないなら削除する
- 記録欄（`docs/現地テスト_2026-09-15_NEHOPS_TLリンカーン.md`）を埋める

---

## 詰まったときの対処

| 症状 | 対処 |
|------|------|
| `.ps1` が実行できない（このシステムではスクリプトの実行が無効） | `powershell -ExecutionPolicy Bypass -File <パス>` で呼ぶ。GPOで `MachinePolicy` が Restricted だとこれも拒否される → PAD か手動に切り替え |
| SmartScreenで `node.exe` が止まる | `Unblock-File`（出発前に実施）。現地なら `Get-ChildItem E:\tl-kit -Recurse -File | Unblock-File` |
| `node.exe -v` が動かない | USB実行がポリシーで禁止。フォルダを `C:\hotel-import\` へコピーして実行（**ホテル側の許可が必要**） |
| APIへ到達できない | プロキシ設定を確認。`Invoke-RestMethod -Proxy http://<proxy>:<port>` で通るならプロキシ経由。通らなければ許可申請の対象を記録して持ち帰る |
| CSVの日本語が化ける | 既定は Shift_JIS(CP932)。UTF-8なら `Inspect-ReservationCsv.ps1 -Utf8`、取込側はマッピングの `encoding` を `utf8` に |
| 取込APIが404を返す | 列マッピングが未登録。`PUT /import/mapping` を先に実行する（`source` の綴りも確認） |
| 取込APIが403を返す | 取込用アカウントの権限不足（MANAGER以上が必要）、または他テナントのhotelIdを指定している |
| `run.cmd` が selectors未設定で止まる | 正常な動作。`codegen.cmd` で拾ってから `selectors.json` を埋める |
| ダウンロードが完了しない・タイムアウト | `--headed` で画面を見ながら実行し、完了の目印（画面の文言・通知）を特定して報告する |
| 何を押すか迷う画面が出た | **更新系（更新・登録・反映・送信・削除）は押さない。** 画面を撮って持ち帰り、判断してから進める |
