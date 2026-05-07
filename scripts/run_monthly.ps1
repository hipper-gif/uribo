# 月次サロンボード同期 - Windows タスクスケジューラから呼ぶ
#
# 動作: 前月分の店舗合計+スタッフ別を取得して beauty_payroll_monthly に投入
# ログ: scripts/logs/sync_YYYY-MM-DD_HHMM.log
#
# タスクスケジューラ登録:
#   schtasks /Create /TN "Uribo Salonboard Monthly Sync" `
#     /TR "powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\nikon\projects\uribo\scripts\run_monthly.ps1" `
#     /SC MONTHLY /D 1 /ST 09:00 /RL LIMITED

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

$LogDir = Join-Path $ScriptDir "logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }

$Stamp = Get-Date -Format "yyyy-MM-dd_HHmm"
$LogFile = Join-Path $LogDir "sync_$Stamp.log"

"=== Uribo Salonboard Monthly Sync ===" | Tee-Object -FilePath $LogFile
"開始: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Tee-Object -FilePath $LogFile -Append

try {
    python sync_salonboard.py --with-staff --non-interactive 2>&1 |
        Tee-Object -FilePath $LogFile -Append
    $exit = $LASTEXITCODE
    if ($exit -eq 0) {
        "完了: 正常終了 (exit=$exit)" | Tee-Object -FilePath $LogFile -Append
    } else {
        "失敗: 異常終了 (exit=$exit) - CAPTCHAやログイン失敗の可能性。手動で再実行してください: python sync_salonboard.py --with-staff" |
            Tee-Object -FilePath $LogFile -Append
    }
    exit $exit
} catch {
    "例外: $_" | Tee-Object -FilePath $LogFile -Append
    exit 1
}
