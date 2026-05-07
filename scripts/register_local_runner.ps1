# Windows ログオン時に local_runner.py を自動起動
#
# 実行: 管理者権限PowerShellから
#   powershell -ExecutionPolicy Bypass -File C:\Users\nikon\projects\uribo\scripts\register_local_runner.ps1
#
# 解除: schtasks /Delete /TN "Uribo Local Runner" /F

$TaskName = "Uribo Local Runner"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BatPath = Join-Path $ScriptDir "start_local_runner.bat"

if (-not (Test-Path $BatPath)) {
    Write-Error "start_local_runner.bat が見つかりません: $BatPath"
    exit 1
}

schtasks /Delete /TN $TaskName /F 2>$null

$Action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$BatPath`""
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Days 30)
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive

Register-ScheduledTask -TaskName $TaskName `
    -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal `
    -Description "Uribo /payroll のワンクリック取得用 HTTP サーバー (localhost:8765)。ブラウザからのスクレイプ実行リクエストを受けて sync_salonboard.py を起動する。"

Write-Host ""
Write-Host "登録完了: $TaskName"
Write-Host "今すぐ起動するには:"
Write-Host "  schtasks /Run /TN `"$TaskName`""
Write-Host ""
Write-Host "確認:"
Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo | Format-List NextRunTime, LastRunTime, LastTaskResult
