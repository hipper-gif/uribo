# Windows タスクスケジューラに月次同期を登録
#
# 実行: 管理者権限のPowerShellから
#   powershell -ExecutionPolicy Bypass -File C:\Users\nikon\projects\uribo\scripts\register_task.ps1
#
# 削除: schtasks /Delete /TN "Uribo Salonboard Monthly Sync" /F

$TaskName = "Uribo Salonboard Monthly Sync"
$ScriptPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "run_monthly.ps1"

if (-not (Test-Path $ScriptPath)) {
    Write-Error "run_monthly.ps1 が見つかりません: $ScriptPath"
    exit 1
}

# 既存削除（あれば）
schtasks /Delete /TN $TaskName /F 2>$null

# 新規登録: 毎月1日 09:00、ユーザーログオン中のみ実行
$Action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`""
$Trigger = New-ScheduledTaskTrigger -Monthly -DaysOfMonth 1 -At 9:00am
$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive

Register-ScheduledTask -TaskName $TaskName `
    -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal `
    -Description "サロンボード→Uribo 月次同期 (前月分の売上・スタッフ別給与計算)。Playwright headless=False のためユーザーログイン中のみ動作。"

Write-Host "登録完了: $TaskName"
Write-Host "次回実行予定:"
Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo | Format-List NextRunTime, LastRunTime, LastTaskResult
