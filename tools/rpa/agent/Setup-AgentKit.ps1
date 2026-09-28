<#
.SYNOPSIS
  エージェント（browser-use）をUSBから動かすためのキットを作る（構成A用・事前準備 — #6）。

.DESCRIPTION
  自分のWindows PC（インターネットに出られる環境）で1回だけ実行する。
  uv・Python・依存パッケージをすべてUSBのフォルダ配下に置くので、
  ホテルの業務用PCではインストーラを動かさず・管理者権限も使わずに実行できる。

  レジストリもProgram Filesも触らない。使い終わったらフォルダを消すだけ。

.EXAMPLE
  .\Setup-AgentKit.ps1 -KitPath E:\tl-agent
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$KitPath,
  [string]$PythonVersion = '3.12'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$scriptDir = $PSScriptRoot
New-Item -ItemType Directory -Path $KitPath -Force | Out-Null

# --- 1. uv（単一実行ファイル）---
$uvDir = Join-Path $KitPath 'uv'
if (-not (Test-Path (Join-Path $uvDir 'uv.exe'))) {
  Write-Host 'uv をダウンロードします...'
  $zip = Join-Path $KitPath 'uv.zip'
  Invoke-WebRequest -Uri 'https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip' -OutFile $zip
  Expand-Archive -LiteralPath $zip -DestinationPath $uvDir -Force
  Remove-Item -LiteralPath $zip
}

# --- 2. Python と依存をキット配下に入れる ---
# これらの環境変数がキット内で完結させる肝。現地でも agent.cmd が同じ値を設定する
$env:UV_PYTHON_INSTALL_DIR = Join-Path $KitPath 'python'
$env:UV_CACHE_DIR = Join-Path $KitPath 'cache'
$uv = Join-Path $uvDir 'uv.exe'

Write-Host "Python $PythonVersion を用意します..."
& $uv python install $PythonVersion

foreach ($file in @('run_agent.py', 'pyproject.toml', '.env.example')) {
  Copy-Item -LiteralPath (Join-Path $scriptDir $file) -Destination $KitPath -Force
}

Write-Host '依存パッケージを入れます...'
Push-Location $KitPath
try {
  & $uv venv (Join-Path $KitPath 'venv') --python $PythonVersion
  & $uv pip install --python (Join-Path $KitPath 'venv\Scripts\python.exe') -r (Join-Path $KitPath 'pyproject.toml')
} finally {
  Pop-Location
}

# --- 3. 起動用バッチ（環境変数はこの中だけで設定する。端末の設定を変えない）---
@"
@echo off
rem エージェントを実行する。先に Chrome をデバッグポート付きで起動し、手動でログインしておくこと。
rem APIキーは同じフォルダの .env から run_agent.py が読む（端末の環境変数は変更しない）。
setlocal
set UV_PYTHON_INSTALL_DIR=%~dp0python
set UV_CACHE_DIR=%~dp0cache
"%~dp0venv\Scripts\python.exe" "%~dp0run_agent.py" %*
endlocal
"@ | Set-Content -LiteralPath (Join-Path $KitPath 'agent.cmd') -Encoding ASCII

New-Item -ItemType Directory -Path (Join-Path $KitPath 'out') -Force | Out-Null

Write-Host ''
Write-Host "キットを作りました: $KitPath"
Write-Host '出発前にやること:'
Write-Host '  1) .env.example をコピーして .env を作り、OPENAI_API_KEY を入れる'
Write-Host '  2) 適当なサイトで1回動かしてみる（Chromeを --remote-debugging-port=9222 で起動してから agent.cmd）'
Write-Host '  3) USB全体のブロックを解除:  Get-ChildItem -Path <KitPath> -Recurse -File | Unblock-File'
Write-Host ''
Write-Host '注意: venvは作成時の絶対パスを覚えている。現地でも同じドライブレター（例 E:）で使うこと。'
Write-Host '      ドライブレターが変わって動かない場合は、このスクリプトを現地で再実行すれば cache から復元できる。'
