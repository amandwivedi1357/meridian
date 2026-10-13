param([ValidateSet('Install', 'Start', 'Status', 'Remove')][string]$Action = 'Status')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$names = @('Meridian Nightly Database Backup', 'Meridian Backup Health Check')
$wrapper = Join-Path $PSScriptRoot 'backup-task-run.ps1'
function Assert-OwnedTask($task) {
    if ($task.Actions.Count -ne 1 -or $task.Actions[0].WorkingDirectory -ne $root -or $task.Actions[0].Arguments -notlike "*`"$wrapper`"*") {
        throw 'An unrelated task uses the same name; refusing to change it'
    }
}
if ($Action -eq 'Install') {
    if ((Get-TimeZone).Id -ne 'Arabian Standard Time') { throw 'Nightly 03:00 Asia/Dubai schedule requires Windows Arabian Standard Time; do not silently change system timezone' }
    $node = (Get-Command node -ErrorAction Stop).Source
    $user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    foreach ($index in 0..1) {
        $existing = Get-ScheduledTask -TaskName $names[$index] -ErrorAction SilentlyContinue
        if ($existing) { Assert-OwnedTask $existing }
        $mode = if ($index -eq 0) { 'Run' } else { 'Check' }
        $arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$wrapper`" -Mode $mode -NodePath `"$node`""
        $taskAction = New-ScheduledTaskAction -Execute "$env:SystemRoot/System32/WindowsPowerShell/v1.0/powershell.exe" -Argument $arguments -WorkingDirectory $root
        $trigger = if ($index -eq 0) { New-ScheduledTaskTrigger -Daily -At '03:00' } else { New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 30) }
        $logon = New-ScheduledTaskTrigger -AtLogOn -User $user
        $limit = if ($index -eq 0) { 50 } else { 2 }
        $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes $limit) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
        if ($index -eq 0) { $settings.RestartCount = 3; $settings.RestartInterval = 'PT5M' }
        Register-ScheduledTask -TaskName $names[$index] -Action $taskAction -Trigger @($trigger, $logon) -Principal $principal -Settings $settings -Description 'Meridian local-only restore-verified backup/health; current user; no trading, cloud upload or wake timer.' -Force | Out-Null
    }
} elseif ($Action -eq 'Start') {
    $task = Get-ScheduledTask -TaskName $names[0]
    Assert-OwnedTask $task
    Start-ScheduledTask -TaskName $names[0]
} elseif ($Action -eq 'Remove') {
    foreach ($name in $names) {
        $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
        if ($task) {
            Assert-OwnedTask $task
            if ($task.State -eq 'Running') { throw 'Backup/monitor task is running; wait for completion before removing' }
            Unregister-ScheduledTask -TaskName $name -Confirm:$false
        }
    }
}
foreach ($name in $names) {
    $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    if ($task) {
        $info = Get-ScheduledTaskInfo -TaskName $name
        [PSCustomObject]@{ TaskName = $name; State = $task.State; LastRunTime = $info.LastRunTime; LastTaskResult = $info.LastTaskResult; NextRunTime = $info.NextRunTime } | Format-List
    }
}
