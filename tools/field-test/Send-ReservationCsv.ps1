<#
.SYNOPSIS
  予約明細CSVをプロダクトの取込APIへ送る（無人運用の送信側 — #6）。

.DESCRIPTION
  サイトコントローラーから出力されたCSVを、ホテル内のWindows端末から
  定期的に送り続けるためのスクリプト。タスクスケジューラから呼ぶ前提で書いている。

    - 追加インストール不要（Windows標準のPowerShellのみ）
    - パスワードは平文で置かない（DPAPIで暗号化したファイルを使う。作成は -SavePassword）
    - 失敗時はリトライし、それでも失敗したら終了コード1で終わる（スケジューラが失敗を記録できる）
    - 実行結果は1行1JSONでログに追記する（後から欠損を追える）

  取込は列マッピングをサーバ側に保存してある前提。端末はファイルを送るだけ。

.EXAMPLE
  # 初回のみ: 取込用アカウントのパスワードをこの端末・このユーザー専用に暗号化して保存
  .\Send-ReservationCsv.ps1 -SavePassword -CredentialPath C:\hotel-import\cred.txt

.EXAMPLE
  # 単発送信（まずは -DryRun で疎通確認）
  .\Send-ReservationCsv.ps1 -Endpoint http://192.168.1.50:3001 -Email import@example.com `
    -CredentialPath C:\hotel-import\cred.txt -HotelId demo-hotel-001 `
    -CsvPath C:\hotel-import\in\reservations.csv -DryRun

.EXAMPLE
  # 無人運用: フォルダ内の最新CSVを送り、成功したら処理済みへ移動
  .\Send-ReservationCsv.ps1 -Endpoint https://api.example.com -Email import@example.com `
    -CredentialPath C:\hotel-import\cred.txt -HotelId demo-hotel-001 `
    -WatchFolder C:\hotel-import\in -FilePattern *.csv -MoveToFolder C:\hotel-import\done
#>
[CmdletBinding(DefaultParameterSetName = 'Send')]
param(
  # --- パスワード保存モード ---
  [Parameter(ParameterSetName = 'SavePassword', Mandatory = $true)][switch]$SavePassword,

  # --- 送信モード ---
  [Parameter(ParameterSetName = 'Send', Mandatory = $true)][string]$Endpoint,
  [Parameter(ParameterSetName = 'Send', Mandatory = $true)][string]$Email,
  [Parameter(ParameterSetName = 'Send', Mandatory = $true)][string]$HotelId,
  [Parameter(ParameterSetName = 'Send')][string]$CsvPath,
  [Parameter(ParameterSetName = 'Send')][string]$WatchFolder,
  [Parameter(ParameterSetName = 'Send')][string]$FilePattern = '*.csv',
  [Parameter(ParameterSetName = 'Send')][string]$MoveToFolder,
  [Parameter(ParameterSetName = 'Send')][string]$Source = 'tl-lincoln',
  [Parameter(ParameterSetName = 'Send')][switch]$DryRun,
  # CSVを出力した日（既定は実行日）。これより未来のブッキングカーブ点は作られない
  [Parameter(ParameterSetName = 'Send')][string]$AsOf,
  [Parameter(ParameterSetName = 'Send')][int]$MaxRetries = 3,
  [Parameter(ParameterSetName = 'Send')][int]$RetryDelaySeconds = 20,

  # --- 共通 ---
  [string]$CredentialPath = (Join-Path $PSScriptRoot 'cred.txt'),
  [string]$LogDir = (Join-Path $PSScriptRoot 'logs')
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# ------------------------------------------------------------
# パスワード保存モード（DPAPI: この端末・このユーザーでしか復号できない）
# ------------------------------------------------------------
if ($PSCmdlet.ParameterSetName -eq 'SavePassword') {
  $secure = Read-Host -AsSecureString -Prompt '取込用アカウントのパスワード'
  $dir = Split-Path -Parent $CredentialPath
  if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  $secure | ConvertFrom-SecureString | Set-Content -LiteralPath $CredentialPath -Encoding ASCII
  Write-Host "保存しました: $CredentialPath"
  Write-Host 'このファイルは同じ端末・同じユーザーでしか復号できません。別端末では再作成が必要です。'
  return
}

# ------------------------------------------------------------
# ログ（1行1JSON。スケジューラ経由でも後から追える形にする）
# ------------------------------------------------------------
if (-not (Test-Path -LiteralPath $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$logPath = Join-Path $LogDir ("send-{0}.log" -f (Get-Date -Format 'yyyyMMdd'))

function Write-Log {
  param([string]$Level, [string]$Message, [hashtable]$Data = @{})
  $entry = [ordered]@{
    time    = (Get-Date).ToString('o')
    level   = $Level
    message = $Message
  }
  foreach ($key in $Data.Keys) { $entry[$key] = $Data[$key] }
  $line = ($entry | ConvertTo-Json -Compress -Depth 5)
  Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
  if ($Level -eq 'error') { Write-Host $Message -ForegroundColor Red } else { Write-Host $Message }
}

function Get-TargetFile {
  if ($CsvPath) {
    if (-not (Test-Path -LiteralPath $CsvPath)) { throw "CSVが見つかりません: $CsvPath" }
    return Get-Item -LiteralPath $CsvPath
  }
  if (-not $WatchFolder) { throw '-CsvPath か -WatchFolder のどちらかを指定してください' }
  if (-not (Test-Path -LiteralPath $WatchFolder)) { throw "フォルダが見つかりません: $WatchFolder" }
  $newest = Get-ChildItem -LiteralPath $WatchFolder -Filter $FilePattern -File |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $newest) { throw "送信対象のCSVがありません: $WatchFolder\$FilePattern" }
  # 出力途中のファイルを掴まないよう、書き込みが落ち着くまで少し待って再確認する
  $before = $newest.Length
  Start-Sleep -Seconds 3
  $after = (Get-Item -LiteralPath $newest.FullName).Length
  if ($before -ne $after) { throw "ファイルが書き込み中です: $($newest.Name)" }
  return $newest
}

function Get-PlainPassword {
  # 1) 環境変数（シークレットストアやCIから渡す場合。端末の常設運用では 2) を使う）
  if ($env:HOTEL_IMPORT_PASSWORD) { return $env:HOTEL_IMPORT_PASSWORD }

  # 2) DPAPIで暗号化したファイル（同じ端末・同じユーザーでしか復号できない）
  if (-not (Test-Path -LiteralPath $CredentialPath)) {
    throw "認証情報がありません。-SavePassword で $CredentialPath を作成するか、環境変数 HOTEL_IMPORT_PASSWORD を設定してください"
  }
  $secure = Get-Content -LiteralPath $CredentialPath -Raw | ConvertTo-SecureString
  return [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
           [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}

function Get-AccessToken {
  $plain = Get-PlainPassword
  try {
    $body = @{ email = $Email; password = $plain } | ConvertTo-Json -Compress
    $response = Invoke-RestMethod -Uri "$Endpoint/api/v1/auth/login" -Method Post `
                  -ContentType 'application/json; charset=utf-8' -Body $body -TimeoutSec 30
    if (-not $response.success) { throw 'ログインに失敗しました' }
    return $response.data.tokens.accessToken
  } finally {
    # 平文パスワードをメモリに残さない
    $plain = $null
    [System.GC]::Collect()
  }
}

function Send-Csv {
  param([System.IO.FileInfo]$File, [string]$Token)

  $asOfValue = if ($AsOf) { $AsOf } else { (Get-Date -Format 'yyyy-MM-dd') }
  $query = @(
    "hotelId=$([uri]::EscapeDataString($HotelId))"
    "source=$([uri]::EscapeDataString($Source))"
    "asOf=$asOfValue"
    "fileName=$([uri]::EscapeDataString($File.Name))"
    "dryRun=$(if ($DryRun) { 'true' } else { 'false' })"
  ) -join '&'

  return Invoke-RestMethod -Uri "$Endpoint/api/v1/import/reservations?$query" -Method Post `
           -Headers @{ Authorization = "Bearer $Token" } -ContentType 'text/csv' `
           -InFile $File.FullName -TimeoutSec 300
}

# ------------------------------------------------------------
# 本体
# ------------------------------------------------------------
$exitCode = 1
try {
  $file = Get-TargetFile
  Write-Log -Level 'info' -Message "送信対象: $($file.Name)" -Data @{ bytes = $file.Length; dryRun = [bool]$DryRun }

  $attempt = 0
  while ($true) {
    $attempt++
    try {
      $token = Get-AccessToken
      $result = Send-Csv -File $file -Token $token
      $data = $result.data

      Write-Log -Level 'info' -Message "取込成功: $($file.Name)" -Data @{
        runId       = $data.runId
        rowCount    = $data.rowCount
        dailyRows   = $data.summary.dailyRows
        channelRows = $data.summary.channelRows
        curveRows   = $data.summary.curveRows
        skippedRows = $data.skippedRows
        dryRun      = $data.dryRun
        attempt     = $attempt
      }
      foreach ($warning in @($data.warnings)) {
        if ($warning) { Write-Log -Level 'warn' -Message "注意: $warning" }
      }

      if ($MoveToFolder -and -not $DryRun) {
        if (-not (Test-Path -LiteralPath $MoveToFolder)) { New-Item -ItemType Directory -Path $MoveToFolder | Out-Null }
        $stamped = "{0}_{1}{2}" -f $file.BaseName, (Get-Date -Format 'yyyyMMdd-HHmmss'), $file.Extension
        Move-Item -LiteralPath $file.FullName -Destination (Join-Path $MoveToFolder $stamped)
        Write-Log -Level 'info' -Message "処理済みへ移動: $stamped"
      }

      $exitCode = 0
      break
    } catch {
      $message = $_.Exception.Message
      # 400番台は再送しても同じ結果になるので即中断する（マッピング未設定・権限不足など）
      $status = $null
      if ($_.Exception.PSObject.Properties.Name -contains 'Response' -and $_.Exception.Response) {
        try { $status = [int]$_.Exception.Response.StatusCode } catch { $status = $null }
      }
      $retryable = -not ($status -ge 400 -and $status -lt 500)

      if ($attempt -ge $MaxRetries -or -not $retryable) {
        Write-Log -Level 'error' -Message "取込に失敗しました: $message" -Data @{
          attempt = $attempt; status = $status; retryable = $retryable; file = $file.Name
        }
        break
      }
      Write-Log -Level 'warn' -Message "失敗したのでリトライします（$attempt/$MaxRetries）: $message" -Data @{ status = $status }
      Start-Sleep -Seconds $RetryDelaySeconds
    }
  }
} catch {
  Write-Log -Level 'error' -Message "実行前に失敗しました: $($_.Exception.Message)"
}

exit $exitCode
