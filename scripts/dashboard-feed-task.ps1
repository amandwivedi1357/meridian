param([ValidateSet('Install', 'Start', 'Stop', 'Status', 'Remove')][string]$Action = 'Status')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$taskName = 'Meridian Dashboard Public Feed'
if ($Action -eq 'Install') {
    $node = (Get-Command node -ErrorAction Stop).Source
    if (-not (Test-Path -LiteralPath "$root/apps/ingestor/dist/dashboard-feed.js")) {
        throw 'Build the ingestor first: corepack pnpm --filter @meridian/ingestor build'
    }
    $user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $taskAction = New-ScheduledTaskAction -Execute $node -Argument '--env-file=.env apps/ingestor/dist/dashboard-feed.js' -WorkingDirectory $root
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1)
    Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $trigger -Principal $principal -Settings $settings -Description 'Continuous public Binance dashboard data only. No trading or recording.' -Force | Out-Null
    Start-ScheduledTask -TaskName $taskName
} elseif ($Action -eq 'Start') {
    Start-ScheduledTask -TaskName $taskName
} elseif ($Action -eq 'Stop') {
    Stop-ScheduledTask -TaskName $taskName
} elseif ($Action -eq 'Remove') {
    Stop-ScheduledTask -TaskName $taskName
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
if ($Action -ne 'Remove') {
    Get-ScheduledTask -TaskName $taskName | Select-Object TaskName, State
    Get-ScheduledTaskInfo -TaskName $taskName | Select-Object LastRunTime, LastTaskResult, NextRunTime
}
