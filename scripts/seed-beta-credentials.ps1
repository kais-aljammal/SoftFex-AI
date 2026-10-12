param([string]$Directory=(Join-Path $env:APPDATA 'SoftFex AI'))
$ErrorActionPreference='Stop'
$credentialPath=Join-Path $Directory 'credentials.env'
if(Test-Path -LiteralPath $credentialPath){Write-Output 'Existing user credential storage preserved; no migration performed.';exit 0}
$developmentPath=Join-Path (Split-Path -Parent $PSScriptRoot) '.env'
$lines=[IO.File]::ReadAllLines($developmentPath)
$global:softfexSeedKey=$null
function global:Read-Host {param([string]$Prompt,[switch]$AsSecureString);if($AsSecureString){return (ConvertTo-SecureString $global:softfexSeedKey -AsPlainText -Force)};return ''}
try {
    foreach($provider in @('anthropic','deepgram')){
        $variableName=if($provider -eq 'anthropic'){'ANTHROPIC_API_KEY'}else{'DEEPGRAM_API_KEY'}
        $line=$lines | Where-Object {$_ -match ('^'+$variableName+'=')} | Select-Object -First 1
        if(!$line){continue}
        $global:softfexSeedKey=$line.Substring($variableName.Length+1).Trim().Trim('"',"'")
        if(!$global:softfexSeedKey){continue}
        & (Join-Path $PSScriptRoot 'configure-key.ps1') -Directory $Directory -Provider $provider
        $global:softfexSeedKey=$null
    }
    if(!(Test-Path -LiteralPath $credentialPath)){throw 'Credential migration did not create private storage.'}
    Write-Output 'Private beta credential setup completed using the real setup helper; no key was displayed.'
} finally {$global:softfexSeedKey=$null;$lines=$null;Remove-Variable -Name softfexSeedKey -Scope Global -ErrorAction SilentlyContinue;Remove-Item Function:\Read-Host -ErrorAction SilentlyContinue}
