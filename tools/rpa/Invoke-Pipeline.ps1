<#
.SYNOPSIS
  取得（RPA）→ 送信（取込API）を1回のタスクで通す（現地端末で無人実行する — #6）。

.DESCRIPTION
  タスクスケジューラに登録するのはこのスクリプト1本だけにする。
    1. run.cmd（携帯版Playwright）でCSVを out\ に落とす
    2. Send-ReservationCsv.ps1 で取込APIへ送る
  どちらかが失敗したら終了コード1で終わり、スケジューラに失敗が残る。

  取得が失敗したときは送信に進まない（古いCSVを二重送信しないため。
  同じ内容ならサーバ側でも重複として検知されるが、失敗を成功に見せないことを優先する）。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\Invoke-Pipeline.ps1 `
    -KitPath C:\hotel-import\tl-kit -Endpoint https://api.example.com `
    -Email import@example.com -HotelId <hotelId> -Days 30
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$KitPath,
  [Parameter(Mandatory = $true)][string]$Endpoint,
  [Parameter(Mandatory = $true)][string]$Email,
  [Parameter(Mandatory = $true)][string]$HotelId,
  [string]$SenderPath = (Join-Path $PSScriptRoot '..\field-test\Send-ReservationCsv.ps1'),
  [string]$CredentialPath = (Join-Path $PSScriptRoot 'cred.txt'),
  [string]$Source = 'tl-lincoln',
  [int]$Days = 30,
  [switch]$DryRun,
  [string]$LogDir = (Join-Path $PSScriptRoot 'logs')
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not (Test-Path -LiteralPath $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$logPath = Join-Path $LogDir ("pipeline-{0}.log" -f (Get-Date -Format 'yyyyMMdd'))

function Write-Log {
  param([string]$Level, [string]$Message)
  $line = ([ordered]@{ time = (Get-Date).ToString('o'); level = $Level; message = $Message } |
           ConvertTo-Json -Compress)
  Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
  if ($Level -eq 'error') { Write-Host $Message -ForegroundColor Red } else { Write-Host $Message }
}

$outDir = Join-Path $KitPath 'out'
$runCmd = Join-Path $KitPath 'run.cmd'
if (-not (Test-Path -LiteralPath $runCmd)) {
  Write-Log 'error' "キットが見つかりません: $runCmd （Setup-PortablePlaywright.ps1 で作成してください）"
  exit 1
}

# ------------------------------------------------------------
# 1. 取得
# ------------------------------------------------------------
$before = @(Get-ChildItem -LiteralPath $outDir -Filter '*.csv' -File -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty FullName)

Write-Log 'info' "取得を開始します（直近 $Days 日）"
# TL_USER / TL_PASSWORD は呼び出し元（タスクの実行ユーザー環境）で設定しておく
& $runCmd '--days' $Days
$exportExit = $LASTEXITCODE

if ($exportExit -ne 0) {
  $detail = if (Test-Path -LiteralPath (Join-Path $outDir 'last-error.txt')) {
    (Get-Content -LiteralPath (Join-Path $outDir 'last-error.txt') -Raw).Split("`n")[1]
  } else { '（詳細なし）' }
  Write-Log 'error' "取得に失敗しました: $detail"
  exit 1
}

$after = @(Get-ChildItem -LiteralPath $outDir -Filter '*.csv' -File |
           Sort-Object LastWriteTime -Descending)
$fresh = @($after | Where-Object { $before -notcontains $_.FullName })
if ($fresh.Count -eq 0) {
  Write-Log 'error' '取得は成功を返しましたが、新しいCSVが増えていません（画面変更の可能性）'
  exit 1
}
$csv = $fresh[0]
Write-Log 'info' "取得しました: $($csv.Name)（$($csv.Length) bytes）"

# ------------------------------------------------------------
# 2. 送信
# ------------------------------------------------------------
$senderArgs = @(
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $SenderPath,
  '-Endpoint', $Endpoint, '-Email', $Email, '-HotelId', $HotelId,
  '-CredentialPath', $CredentialPath, '-Source', $Source,
  '-CsvPath', $csv.FullName, '-LogDir', $LogDir
)
if ($DryRun) { $senderArgs += '-DryRun' }

Write-Log 'info' '送信を開始します'
& powershell @senderArgs
$sendExit = $LASTEXITCODE

if ($sendExit -ne 0) {
  Write-Log 'error' "送信に失敗しました（終了コード $sendExit）。CSVは $($csv.FullName) に残しています"
  exit 1
}

Write-Log 'info' '取得から取込まで完了しました'
exit 0
