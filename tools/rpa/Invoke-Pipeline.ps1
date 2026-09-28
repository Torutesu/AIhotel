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
[CmdletBinding(DefaultParameterSetName = 'Run')]
param(
  # --- TL-リンカーンのパスワードを保存するモード（初回のみ） ---
  [Parameter(ParameterSetName = 'SaveTlPassword', Mandatory = $true)][switch]$SaveTlPassword,

  # --- 実行モード ---
  [Parameter(ParameterSetName = 'Run', Mandatory = $true)][string]$KitPath,
  [Parameter(ParameterSetName = 'Run', Mandatory = $true)][string]$Endpoint,
  [Parameter(ParameterSetName = 'Run', Mandatory = $true)][string]$Email,
  [Parameter(ParameterSetName = 'Run', Mandatory = $true)][string]$HotelId,
  # TL-リンカーンのログインID。パスワードは $TlCredentialPath から読む
  [Parameter(ParameterSetName = 'Run')][string]$TlUser,
  # 決定論的な取得（run.cmd）が失敗したときだけ、エージェントに肩代わりさせる
  [Parameter(ParameterSetName = 'Run')][switch]$AgentFallback,
  [Parameter(ParameterSetName = 'Run')][string]$AgentKitPath,
  # フォールバックに使うコマンド。既定は browser-use のキット（agent.cmd）。
  # Codex を使うなら codex-fallback.cmd のパスを渡す
  [Parameter(ParameterSetName = 'Run')][string]$FallbackCommand,
  [string]$TlCredentialPath = (Join-Path $PSScriptRoot 'tl-cred.txt'),
  [string]$SenderPath = (Join-Path $PSScriptRoot '..\field-test\Send-ReservationCsv.ps1'),
  [string]$CredentialPath = (Join-Path $PSScriptRoot 'cred.txt'),
  [string]$Source = 'tl-lincoln',
  [int]$Days = 30,
  [switch]$DryRun,
  [string]$LogDir = (Join-Path $PSScriptRoot 'logs')
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# TL-リンカーンのパスワードをこの端末・このユーザー専用に暗号化して保存する（DPAPI）。
# タスクスケジューラから無人実行するとき、環境変数に平文を残さないための入り口。
if ($PSCmdlet.ParameterSetName -eq 'SaveTlPassword') {
  $secure = Read-Host -AsSecureString -Prompt 'TL-リンカーンのパスワード'
  $dir = Split-Path -Parent $TlCredentialPath
  if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  $secure | ConvertFrom-SecureString | Set-Content -LiteralPath $TlCredentialPath -Encoding ASCII
  Write-Host "保存しました: $TlCredentialPath"
  Write-Host '同じ端末・同じユーザーでしか復号できません。別端末では再作成が必要です。'
  return
}

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

# TL-リンカーンの認証情報は、ここで復号してこのプロセス限定の環境変数に載せる。
# 端末の環境変数（setx）やスクリプトには残さない。プロセス終了と同時に消える。
if ($TlUser) {
  if (-not (Test-Path -LiteralPath $TlCredentialPath)) {
    Write-Log 'error' "TLの認証情報がありません: $TlCredentialPath （-SaveTlPassword で作成してください）"
    exit 1
  }
  $secure = Get-Content -LiteralPath $TlCredentialPath -Raw | ConvertTo-SecureString
  $env:TL_USER = $TlUser
  $env:TL_PASSWORD = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
                       [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
} elseif (-not $env:TL_USER) {
  Write-Log 'error' '-TlUser を指定するか、環境変数 TL_USER / TL_PASSWORD を設定してください'
  exit 1
}

Write-Log 'info' "取得を開始します（直近 $Days 日）"
try {
  & $runCmd '--days' $Days
  $exportExit = $LASTEXITCODE
} finally {
  # 復号したパスワードをこのプロセスからも消す
  $env:TL_PASSWORD = $null
}

$usedAgent = $false

if ($exportExit -ne 0) {
  $detail = if (Test-Path -LiteralPath (Join-Path $outDir 'last-error.txt')) {
    (Get-Content -LiteralPath (Join-Path $outDir 'last-error.txt') -Raw).Split("`n")[1]
  } else { '（詳細なし）' }
  Write-Log 'error' "取得に失敗しました: $detail"

  # 画面が変わってセレクタが効かなくなった場合の自動復旧。
  # 毎日ここを通るなら selectors.json を直すべきで、通った回数がそのまま
  # 「エージェントに払っている額」になる（result_*.json の usage で確認する）
  if (-not $AgentFallback) { exit 1 }

  # 三項演算子は PowerShell 7 以降なので使わない（業務PCは 5.1 のことが多い）
  $agentRoot = if ($AgentKitPath) { $AgentKitPath } else { Join-Path $PSScriptRoot 'agent' }
  $agentCmd = if ($FallbackCommand) { $FallbackCommand } else { Join-Path $agentRoot 'agent.cmd' }
  if (-not (Test-Path -LiteralPath $agentCmd)) {
    Write-Log 'error' "フォールバックのコマンドが見つかりません: $agentCmd"
    exit 1
  }

  Write-Log 'warn' 'エージェントで取得を試みます（決定論的な取得が失敗したため）'
  & $agentCmd '--days' $Days
  if ($LASTEXITCODE -ne 0) {
    Write-Log 'error' "エージェントでも取得できませんでした（終了コード $LASTEXITCODE）"
    exit 1
  }
  $usedAgent = $true
  # フォールバック側の出力先に切り替える（CSVはそちらに落ちる）
  $outDir = Join-Path (Split-Path -Parent $agentCmd) 'out'
}

$after = @(Get-ChildItem -LiteralPath $outDir -Filter '*.csv' -File |
           Sort-Object LastWriteTime -Descending)
$fresh = @($after | Where-Object { $before -notcontains $_.FullName })
if ($fresh.Count -eq 0) {
  Write-Log 'error' '取得は成功を返しましたが、新しいCSVが増えていません（画面変更の可能性）'
  exit 1
}
$csv = $fresh[0]
Write-Log 'info' "取得しました: $($csv.Name)（$($csv.Length) bytes / 経路: $(if ($usedAgent) { 'エージェント' } else { '決定論' })）"
if ($usedAgent) {
  Write-Log 'warn' 'エージェント経由で取得した。画面が変わった可能性が高いので selectors.json を見直すこと'
}

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
