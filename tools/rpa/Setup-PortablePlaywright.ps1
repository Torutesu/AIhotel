<#
.SYNOPSIS
  USBで持ち運べる Playwright キットを作る（現地端末にインストールしないための準備 — #6）。

.DESCRIPTION
  自分のWindows PC（インターネットに出られる環境）で1回だけ実行する。
  Node.js の zip 版とブラウザをUSBのフォルダ配下に展開するため、
  ホテルの業務用PCではインストーラを動かさず・管理者権限も使わずに実行できる。

  レジストリも Program Files も触らない。使い終わったらフォルダを消すだけで残らない。

.EXAMPLE
  .\Setup-PortablePlaywright.ps1 -KitPath E:\tl-kit
#>
[CmdletBinding()]
param(
  # キットを作る場所（USBドライブを指定する）
  [Parameter(Mandatory = $true)][string]$KitPath,
  # 固定しておくバージョン（現地で挙動が変わらないようにする）
  [string]$NodeVersion = '22.14.0',
  [string]$PlaywrightVersion = '1.50.1'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$scriptDir = $PSScriptRoot
New-Item -ItemType Directory -Path $KitPath -Force | Out-Null
$nodeDir = Join-Path $KitPath 'node'
$browsersDir = Join-Path $KitPath 'browsers'

# ------------------------------------------------------------
# 1. 携帯版 Node.js
# ------------------------------------------------------------
if (Test-Path (Join-Path $nodeDir 'node.exe')) {
  Write-Host "Node.js は既にあります: $nodeDir"
} else {
  $zipName = "node-v$NodeVersion-win-x64"
  $zipPath = Join-Path $KitPath "$zipName.zip"
  Write-Host "Node.js $NodeVersion をダウンロードします..."
  Invoke-WebRequest -Uri "https://nodejs.org/dist/v$NodeVersion/$zipName.zip" -OutFile $zipPath
  Write-Host '展開します...'
  Expand-Archive -LiteralPath $zipPath -DestinationPath $KitPath -Force
  Move-Item -LiteralPath (Join-Path $KitPath $zipName) -Destination $nodeDir
  Remove-Item -LiteralPath $zipPath
}

$env:Path = "$nodeDir;$env:Path"
$env:PLAYWRIGHT_BROWSERS_PATH = $browsersDir

# ------------------------------------------------------------
# 2. Playwright とブラウザ（キットの中に入れる）
# ------------------------------------------------------------
Push-Location $KitPath
try {
  if (-not (Test-Path (Join-Path $KitPath 'package.json'))) {
    '{ "name": "tl-kit", "private": true, "type": "module" }' |
      Set-Content -LiteralPath (Join-Path $KitPath 'package.json') -Encoding UTF8
  }
  Write-Host "playwright@$PlaywrightVersion を入れます..."
  & (Join-Path $nodeDir 'npm.cmd') install "playwright@$PlaywrightVersion" --no-audit --no-fund
  Write-Host 'Chromium を取得します（キット内の browsers\ に入ります）...'
  & (Join-Path $nodeDir 'npx.cmd') playwright install chromium
} finally {
  Pop-Location
}

# ------------------------------------------------------------
# 3. 取得スクリプトと起動用バッチ
# ------------------------------------------------------------
foreach ($file in @('export-tl.mjs', 'selectors.example.json', 'README.md')) {
  $src = Join-Path $scriptDir $file
  if (Test-Path $src) { Copy-Item -LiteralPath $src -Destination $KitPath -Force }
}
$selectors = Join-Path $KitPath 'selectors.json'
if (-not (Test-Path $selectors)) {
  Copy-Item -LiteralPath (Join-Path $KitPath 'selectors.example.json') -Destination $selectors
}

# 環境変数はバッチの中だけで設定する（端末の設定を変えない）
@"
@echo off
rem 操作を記録してコードにする: codegen.cmd https://<TLのURL>
setlocal
set PATH=%~dp0node;%PATH%
set PLAYWRIGHT_BROWSERS_PATH=%~dp0browsers
"%~dp0node\npx.cmd" playwright codegen --save-storage="%~dp0out\storage.json" --save-trace="%~dp0out\codegen-trace.zip" %*
endlocal
"@ | Set-Content -LiteralPath (Join-Path $KitPath 'codegen.cmd') -Encoding ASCII

@"
@echo off
rem 取得を実行する。CSVは out\ に落ちる
setlocal
set PATH=%~dp0node;%PATH%
set PLAYWRIGHT_BROWSERS_PATH=%~dp0browsers
"%~dp0node\node.exe" "%~dp0export-tl.mjs" %*
endlocal
"@ | Set-Content -LiteralPath (Join-Path $KitPath 'run.cmd') -Encoding ASCII

New-Item -ItemType Directory -Path (Join-Path $KitPath 'out') -Force | Out-Null

Write-Host ''
Write-Host "キットを作りました: $KitPath"
Write-Host '現地での使い方:'
Write-Host '  1) codegen.cmd https://<TLのURL>   … 操作を記録してセレクタを拾う'
Write-Host '  2) selectors.json を埋める'
Write-Host '  3) run.cmd                          … 取得を実行（out\ にCSV）'
Write-Host ''
Write-Host 'USBから起動できない環境の場合は、フォルダごと端末のローカルへコピーして実行する（ホテル側の許可が必要）。'
