param(
    [ValidateSet('Run', 'Check')][string]$Mode,
    [Parameter(Mandatory = $true)][string]$NodePath
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$directory = Join-Path $root 'logs/verification/phase-5/backups/local'
New-Item -ItemType Directory -Path $directory -Force | Out-Null
if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw 'Configured Node executable unavailable' }
$process = Start-Process -FilePath $NodePath -ArgumentList @('scripts/local-backup.cjs', $Mode.ToLowerInvariant()) -WorkingDirectory $root -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput (Join-Path $directory "$Mode.out.log") -RedirectStandardError (Join-Path $directory "$Mode.err.log")
$process.Refresh()
if ($null -eq $process.ExitCode) { exit 1 }
exit $process.ExitCode
