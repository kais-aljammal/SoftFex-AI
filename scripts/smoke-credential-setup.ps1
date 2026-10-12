$ErrorActionPreference='Stop'
$testDirectory=Join-Path $env:TEMP ('softfex-credential-smoke-'+[guid]::NewGuid().ToString('N'))
# Synthetic prompt replacement: never reads or displays a real credential.
function global:Read-Host { param([string]$Prompt,[switch]$AsSecureString); if($AsSecureString){return (ConvertTo-SecureString ('sk-ant-'+('x'*40)) -AsPlainText -Force)};return '' }
try {
    & (Join-Path $PSScriptRoot 'configure-key.ps1') -Directory $testDirectory -Provider anthropic
    $file=Join-Path $testDirectory 'credentials.env'
    if(!(Test-Path -LiteralPath $file)){throw 'Credential was not saved'}
    function Assert-PrivateFile {
        $acl=Get-Acl -LiteralPath $file
        $identity=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        $rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
        if(!$acl.AreAccessRulesProtected -or $rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $identity){throw 'Credential ACL is not protected for current user only'}
    }
    Assert-PrivateFile
    & (Join-Path $PSScriptRoot 'configure-key.ps1') -Directory $testDirectory -Provider deepgram
    $content=[IO.File]::ReadAllText($file)
    if($content -notmatch '^ANTHROPIC_API_KEY=' -or $content -notmatch '(?m)^DEEPGRAM_API_KEY='){throw 'Second setup lost first provider'}
    Assert-PrivateFile
    Write-Output 'PASS: synthetic masked setup, private current-user ACL and atomic replacement preserving providers.'
} finally {
    $resolved=[IO.Path]::GetFullPath($testDirectory)
    $expectedRoot=[IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')+'\softfex-credential-smoke-'
    if($resolved.StartsWith($expectedRoot,[StringComparison]::OrdinalIgnoreCase)){Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue}
    Remove-Item Function:\Read-Host -ErrorAction SilentlyContinue
}
