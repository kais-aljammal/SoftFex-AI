param([Parameter(Mandatory=$true)][string]$Directory,[ValidateSet('anthropic','deepgram')][string]$Provider='anthropic')
$ErrorActionPreference='Stop'
$Host.UI.RawUI.WindowTitle='SoftFex API key setup'
$keyPointer=[IntPtr]::Zero
$secureKey=$null
$temporaryPath=$null
$stage='private directory access'
try {
    $credentialDirectory=[IO.Path]::GetFullPath($Directory)
    [IO.Directory]::CreateDirectory($credentialDirectory) | Out-Null
    $identity=[Security.Principal.WindowsIdentity]::GetCurrent().User
    function Set-PrivateAccess([string]$Target,[bool]$IsDirectory) {
        $grant='*'+$identity.Value+':'+$(if($IsDirectory){'(OI)(CI)F'}else{'F'})
        & icacls.exe $Target '/grant:r' $grant '/inheritance:r' | Out-Null
        if($LASTEXITCODE -ne 0){throw 'Private access could not be applied.'}
        $rules=@((Get-Acl -LiteralPath $Target).GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
        foreach($rule in $rules){if($rule.IdentityReference.Value -ne $identity.Value){& icacls.exe $Target '/remove' ('*'+$rule.IdentityReference.Value) | Out-Null;if($LASTEXITCODE -ne 0){throw 'Private access could not be applied.'}}}
    }
    Set-PrivateAccess $credentialDirectory $true
    $stage='masked input'
    $variableName=if($Provider -eq 'anthropic'){'ANTHROPIC_API_KEY'}else{'DEEPGRAM_API_KEY'}
    $secureKey=Read-Host "Enter your $Provider API key (hidden; stored privately for this Windows user)" -AsSecureString
    $keyPointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
    $plainKey=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
    if($plainKey -notmatch '^[A-Za-z0-9_-]{20,256}$' -or ($Provider -eq 'anthropic' -and $plainKey -notmatch '^sk-ant-')){throw 'Key format was not accepted.'}
    $credentialPath=Join-Path $credentialDirectory 'credentials.env'
    $stage='private credential write'
    $existingLines=if(Test-Path -LiteralPath $credentialPath){[IO.File]::ReadAllLines($credentialPath)}else{@()}
    $keptLines=@($existingLines | Where-Object {$_ -notmatch ('^'+$variableName+'=')})
    $temporaryPath=Join-Path $credentialDirectory ('credentials-'+[guid]::NewGuid().ToString('N')+'.tmp')
    [IO.File]::WriteAllText($temporaryPath,'',[Text.UTF8Encoding]::new($false))
    Set-PrivateAccess $temporaryPath $false
    [IO.File]::WriteAllLines($temporaryPath,[string[]]@($keptLines+"$variableName=$plainKey"),[Text.UTF8Encoding]::new($false))
    $stage='atomic credential replacement'
    if(Test-Path -LiteralPath $credentialPath){Set-PrivateAccess $credentialPath $false}
    if(-not ('SoftFexPrivateFile' -as [type])){Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class SoftFexPrivateFile { [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool MoveFileEx(string source, string target, int flags); }'}
    # Same-directory atomic replacement preserves the already-private new file DACL.
    if(![SoftFexPrivateFile]::MoveFileEx($temporaryPath,$credentialPath,9)){throw 'Atomic credential replacement failed.'}
    Set-PrivateAccess $credentialPath $false
    Write-Host 'Key saved. Return to SoftFex; configuration refreshes automatically.'
} catch {
    Write-Host "Key setup did not complete ($stage). No key is displayed. Retry from SoftFex."
} finally {
    $plainKey=$null
    if($keyPointer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)}
    if($secureKey){$secureKey.Dispose()}
    if($temporaryPath -and (Test-Path -LiteralPath $temporaryPath)){Remove-Item -LiteralPath $temporaryPath -Force}
}
Read-Host 'Press Enter to close'
