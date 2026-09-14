<#
.SYNOPSIS
  予約明細CSVの中身を調べ、個人情報の列を落としたコピーを作る（現地テスト用）。

.DESCRIPTION
  ホテルの業務用PCで実行することを想定しているため、
    - 追加インストールを一切必要としない（Windows標準のPowerShellのみ）
    - ネットワーク通信を一切行わない（読み書きはローカルファイルだけ）
    - 元のCSVを変更しない（出力は別ファイル）
  という制約で書いている。

  出力される情報は Issue #18 の確認項目に対応する:
    列一覧と空率      → A1（項目一覧）
    日付列の期間      → A5（遡及可能期間）
    候補列の推定      → A2 予約受付日 / A3 取消 / A4 団体区分 / A6 販売先
    -DropColumns      → A12（個人情報を除いた出力）

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\Inspect-ReservationCsv.ps1 -Path .\予約明細.csv

.EXAMPLE
  # 氏名と電話番号を落としたコピーを作る（持ち帰り用）
  powershell -ExecutionPolicy Bypass -File .\Inspect-ReservationCsv.ps1 -Path .\予約明細.csv -DropColumns 宿泊者名,電話番号
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [string]$Delimiter = ',',
  # 文字コード。既定は Shift_JIS(CP932)。UTF-8 のCSVなら -Utf8 を付ける
  [switch]$Utf8,
  # 出力から除外する列名（個人情報など）
  [string[]]$DropColumns = @(),
  # レポートと除外済みCSVの出力先。既定は元ファイルと同じフォルダ
  [string]$OutDir,
  # 各列のサンプルとして表示する件数
  [int]$SampleCount = 3
)

$ErrorActionPreference = 'Stop'

# powershell -File 実行では -DropColumns a,b が「a,b」という1つの文字列として渡るため、
# ここでカンマを分解しておく（ドットソース実行で配列を渡した場合もそのまま通る）
$DropColumns = @($DropColumns | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } |
                 Where-Object { $_ -ne '' })

if (-not (Test-Path -LiteralPath $Path)) { throw "ファイルが見つかりません: $Path" }
$file = Get-Item -LiteralPath $Path
if (-not $OutDir) { $OutDir = $file.DirectoryName }
if (-not (Test-Path -LiteralPath $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }

# PowerShell 5.1 は -Encoding に文字列、7 以降は Encoding オブジェクトを取る
if ($PSVersionTable.PSVersion.Major -ge 6) {
  $encoding = if ($Utf8) { [System.Text.Encoding]::UTF8 } else { [System.Text.Encoding]::GetEncoding(932) }
} else {
  $encoding = if ($Utf8) { 'UTF8' } else { 'Default' }
}

$rows = @(Import-Csv -LiteralPath $file.FullName -Delimiter $Delimiter -Encoding $encoding)
if ($rows.Count -eq 0) { throw 'データ行が0件です。区切り文字（-Delimiter）や文字コード（-Utf8）を確認してください' }

$columns = $rows[0].PSObject.Properties.Name
$report = New-Object System.Collections.Generic.List[string]
function Add-Line([string]$text) { $report.Add($text); Write-Host $text }

Add-Line ''
Add-Line "ファイル : $($file.FullName)"
Add-Line "サイズ   : $([math]::Round($file.Length / 1KB, 1)) KB"
Add-Line "行数     : $($rows.Count)（ヘッダーを除く）"
Add-Line "列数     : $($columns.Count)"
Add-Line ''
Add-Line ('{0,3}  {1,-24} {2,-6} {3}' -f 'No.', '列名', '空率', "サンプル(最大${SampleCount}件)")
Add-Line ('-' * 100)

# 列ごとの中身と、日付として読めるかを1回の走査で見る
# 書式を明示して判定する。汎用の TryParse は "2"（泊数）を日付として拾ってしまうため使わない
[string[]]$dateFormats = @('yyyy/MM/dd', 'yyyy-MM-dd', 'yyyyMMdd', 'yyyy/M/d', 'yyyy-M-d',
                 'yyyy/MM/dd HH:mm', 'yyyy-MM-dd HH:mm', 'yyyy/M/d HH:mm',
                 'yyyy/MM/dd HH:mm:ss', 'yyyy-MM-dd HH:mm:ss',
                 'yyyy年M月d日', 'yyyy年MM月dd日', 'yyyy.MM.dd', 'yyyy.M.d')
$dateRanges = @{}
$index = 0

foreach ($column in $columns) {
  $index++
  $values = @($rows | ForEach-Object { $_.$column } | Where-Object { $_ -ne $null -and $_.ToString().Trim() -ne '' })
  $emptyRate = if ($rows.Count -eq 0) { 0 } else { [math]::Round((($rows.Count - $values.Count) / $rows.Count) * 100) }
  $samples = @($values | Select-Object -Unique | Select-Object -First $SampleCount) -join ' / '
  Add-Line ('{0,3}  {1,-24} {2,-6} {3}' -f $index, $column, "$emptyRate%", $samples)

  $parsed = New-Object System.Collections.Generic.List[datetime]
  foreach ($value in $values) {
    $text = $value.ToString().Trim()
    [datetime]$dt = [datetime]::MinValue
    $ok = [datetime]::TryParseExact($text, $dateFormats, [System.Globalization.CultureInfo]::InvariantCulture,
                                    [System.Globalization.DateTimeStyles]::None, [ref]$dt)
    if ($ok) { $parsed.Add($dt) }
  }
  # 半分以上が日付として読めた列だけ「日付列」とみなす
  if ($values.Count -gt 0 -and $parsed.Count -ge [math]::Ceiling($values.Count / 2)) {
    $sorted = @($parsed | Sort-Object)
    $dateRanges[$column] = @($sorted[0], $sorted[-1])
  }
}

Add-Line ''
Add-Line '■ 日付として読めた列の期間（A5: 遡及可能期間）'
if ($dateRanges.Count -eq 0) {
  Add-Line '  （なし）'
} else {
  foreach ($key in $dateRanges.Keys) {
    $range = $dateRanges[$key]
    Add-Line ("  {0}: {1:yyyy-MM-dd} 〜 {2:yyyy-MM-dd}" -f $key, $range[0], $range[1])
  }
}

# 列名のキーワードから、確認項目に対応しそうな列を拾う（当たりを付けるだけで、判断は人がする）
$hints = [ordered]@{
  'A2 予約受付日'   = @('受付', '申込', '予約日', '成立', '受注', 'Booked', 'Created')
  'A3 取消'         = @('取消', 'キャンセル', 'Cancel', '状態', 'ステータス', 'Status')
  'A4 団体区分'     = @('団体', 'グループ', '法人', '区分', 'Group')
  'A6 販売先'       = @('販売先', '販売店', 'サイト', '経路', 'チャネル', 'エージェント', 'OTA')
  '宿泊日'          = @('宿泊日', '泊日', 'チェックイン', 'チェックイン日', 'IN日', 'Stay', 'Arrival')
  '泊数'            = @('泊数', '連泊', 'Nights')
  '室数・人数'      = @('室数', '部屋数', '人数', '大人', 'Rooms', 'Pax')
  '料金'            = @('料金', '金額', '単価', '売上', 'Rate', 'Amount')
  '室タイプ'        = @('室タイプ', '部屋タイプ', '客室', 'ルーム', 'RoomType')
  '個人情報(A12)'   = @('氏名', '名前', '宿泊者', '代表者', '電話', 'TEL', 'メール', 'Mail', '住所', 'Name', 'Phone')
}

Add-Line ''
Add-Line '■ 確認項目に対応しそうな列（キーワード一致。最終判断は中身を見て行う）'
foreach ($label in $hints.Keys) {
  $matched = @($columns | Where-Object { $column = $_; @($hints[$label] | Where-Object { $column -like "*$_*" }).Count -gt 0 })
  $text = if ($matched.Count -gt 0) { $matched -join ', ' } else { '該当なし ← 要確認' }
  Add-Line ("  {0,-16}: {1}" -f $label, $text)
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$reportPath = Join-Path $OutDir ("$($file.BaseName)_調査_$stamp.txt")
$report | Set-Content -LiteralPath $reportPath -Encoding UTF8
Write-Host ''
Write-Host "レポートを書き出しました: $reportPath"

if ($DropColumns.Count -gt 0) {
  $missing = @($DropColumns | Where-Object { $columns -notcontains $_ })
  if ($missing.Count -gt 0) { Write-Warning "存在しない列名を指定しています: $($missing -join ', ')" }
  $cleanedPath = Join-Path $OutDir ("$($file.BaseName)_個人情報除去_$stamp.csv")
  $rows |
    Select-Object -Property ($columns | Where-Object { $DropColumns -notcontains $_ }) |
    Export-Csv -LiteralPath $cleanedPath -NoTypeInformation -Encoding UTF8
  Write-Host "個人情報を除いたCSVを書き出しました: $cleanedPath"
  Write-Host '  ※ 持ち帰るのはこのファイルだけにする（元CSVは持ち出さない）'
}
