param([switch]$Initialize, [switch]$Check, [switch]$Launch)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$nodeExe = (Get-Command node -ErrorAction Stop).Source
if ($Initialize) {
    & $nodeExe (Join-Path $projectRoot 'scripts\configure.mjs') --init
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
if (-not $Launch) {
    $arguments = @((Join-Path $projectRoot 'scripts\configure.mjs'))
    if ($Check) { $arguments += '--check' }
    & $nodeExe @arguments
    exit $LASTEXITCODE
}
# Credentials are entered without echo and scoped to this launcher and its children.
# No transcript, command argument, file or persistent environment receives the values.
$previousRelay = [Environment]::GetEnvironmentVariable('COMPANION_RELAY_API_KEY', 'Process')
$previousJev = [Environment]::GetEnvironmentVariable('COMPANION_JEV_KEY', 'Process')
function Read-EphemeralCredential([string]$prompt) {
    $secure = Read-Host -Prompt $prompt -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $secure.Dispose() }
}
try {
    if (-not $previousRelay) { $env:COMPANION_RELAY_API_KEY = Read-EphemeralCredential '输入自己的原聊天服务密钥（不保存）' }
    if (-not $previousJev) { $env:COMPANION_JEV_KEY = Read-EphemeralCredential '输入自己的 Jev 密钥（不保存）' }
    & $nodeExe (Join-Path $projectRoot 'scripts\configure.mjs') --check
    if ($LASTEXITCODE -ne 0) {
        Write-Output '本地配置未就绪，未启动服务。密钥输入不代表费用授权。'
        exit $LASTEXITCODE
    }
    & $nodeExe (Join-Path $projectRoot 'dsh\author\start.mjs')
    exit $LASTEXITCODE
} finally {
    [Environment]::SetEnvironmentVariable('COMPANION_RELAY_API_KEY', $previousRelay, 'Process')
    [Environment]::SetEnvironmentVariable('COMPANION_JEV_KEY', $previousJev, 'Process')
}
