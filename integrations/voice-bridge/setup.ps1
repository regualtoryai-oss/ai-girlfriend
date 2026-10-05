param(
    [string]$Python = 'python',
    [switch]$VerifyOnly,
    [switch]$RequireModels
)
$ErrorActionPreference = 'Stop'
$bridgeRoot = $PSScriptRoot
$releaseRoot = (Resolve-Path -LiteralPath (Join-Path $bridgeRoot '..\..')).Path
$venvRoot = Join-Path $releaseRoot '.venv-voice'
$venvPython = Join-Path $venvRoot 'Scripts\python.exe'

function Invoke-CheckedPython([string]$Executable, [string[]]$Arguments) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Python command failed (exit $LASTEXITCODE)." }
}

if ($VerifyOnly) {
    $verificationPython = if (Test-Path -LiteralPath $venvPython) { $venvPython } else { $Python }
    $verificationArguments = @((Join-Path $bridgeRoot 'verify_install.py'))
    if ($RequireModels) { $verificationArguments += '--require-models' }
    Invoke-CheckedPython $verificationPython $verificationArguments
    return
}

Invoke-CheckedPython $Python @('-c', 'import sys; assert sys.version_info[:2] == (3,12), "Use Python 3.12 (audited: 3.12.14)"')
if (-not (Test-Path -LiteralPath $venvPython)) {
    Invoke-CheckedPython $Python @('-m', 'venv', $venvRoot)
}
# Source wheels are small upstream distributions, verified before installation.
Invoke-CheckedPython $venvPython @((Join-Path $bridgeRoot 'verify_install.py'), '--source-only')
# Install exact effective dependency versions, preserving the current CUDA stack.
# --no-deps prevents upstream speech-to-speech from adding unused pipeline engines.
Invoke-CheckedPython $venvPython @('-m', 'pip', 'install', '--no-deps', '-r', (Join-Path $bridgeRoot 'requirements-gpu.txt'))
Invoke-CheckedPython $venvPython @('-m', 'pip', 'install', '--no-deps', '-r', (Join-Path $bridgeRoot 'requirements.lock.txt'))
foreach ($wheelName in @('speech_to_speech-0.2.10-py3-none-any.whl', 'faster_qwen3_tts-0.2.6-py3-none-any.whl', 'qwen_tts-0.1.1-py3-none-any.whl')) {
    Invoke-CheckedPython $venvPython @('-m', 'pip', 'install', '--no-deps', (Join-Path $bridgeRoot "wheels\$wheelName"))
}
$localConfig = Join-Path $bridgeRoot 'bridge-config.json'
if (-not (Test-Path -LiteralPath $localConfig)) {
    Copy-Item -LiteralPath (Join-Path $bridgeRoot 'bridge-config.example.json') -Destination $localConfig
}
Invoke-CheckedPython $venvPython @((Join-Path $bridgeRoot 'verify_install.py'))
Write-Host 'VoiceBridge installed. Install the exact model resources before using STT/TTS; see README.md.'
