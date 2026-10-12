param([ValidateSet('Anthropic','Deepgram')][string]$Provider = 'Anthropic')
$ErrorActionPreference = 'Stop'
$workspacePath = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $workspacePath '.env'
$variableName = if ($Provider -eq 'Anthropic') { 'ANTHROPIC_API_KEY' } else { 'DEEPGRAM_API_KEY' }
$secureKey = Read-Host "Enter your $Provider API key (hidden; saved only to local .env)" -AsSecureString
$keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
try {
    $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
    if ([string]::IsNullOrWhiteSpace($plainKey) -or $plainKey -notmatch '^[A-Za-z0-9_-]{20,256}$' -or ($Provider -eq 'Anthropic' -and $plainKey -notmatch '^sk-ant-')) {
        throw 'Key format was not accepted. No key was saved.'
    }
    $existingLines = if (Test-Path -LiteralPath $envPath) { [IO.File]::ReadAllLines($envPath) } else { @() }
    $keptLines = @($existingLines | Where-Object { $_ -notmatch ('^' + $variableName + '=') })
    [IO.File]::WriteAllLines($envPath, @($keptLines + "$variableName=$plainKey"), [Text.UTF8Encoding]::new($false))
    Write-Host 'Key saved locally. It has not been displayed or sent to Codex.'
} finally {
    $plainKey = $null
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
    $secureKey.Dispose()
}
Read-Host 'Press Enter to close this setup window'
