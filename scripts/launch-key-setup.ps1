param([Parameter(Mandatory=$true)][string]$Directory,[ValidateSet('anthropic','deepgram')][string]$Provider='anthropic')
$ErrorActionPreference='Stop'
$setupPath=Join-Path $PSScriptRoot 'configure-key.ps1'
# Windows file paths cannot contain quotes. API keys never enter arguments.
$arguments='-NoProfile -ExecutionPolicy Bypass -File "{0}" -Directory "{1}" -Provider {2}' -f $setupPath,$Directory,$Provider
Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WindowStyle Normal
