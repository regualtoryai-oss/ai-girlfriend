param(
    [ValidateSet('All', 'Harness', 'Voice')][string]$Phase = 'All',
    [string]$Python = 'python',
    [switch]$CheckOnly,
    [switch]$Json
)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    $failure = @{ schema_version = 1; read_only = $true; ready = $false; status = 'system-dependencies-needed'; error_codes = @('NODE_24_REQUIRED'); next_actions = @('请先安装 Node.js 24 或更高版本，然后重新打开终端。安装器不会安装系统软件或驱动。') }
    if ($Json) { $failure | ConvertTo-Json -Depth 4 } else { Write-Host 'NODE_24_REQUIRED：请先安装 Node.js 24 或更高版本，然后重新打开终端。' }
    exit 2
}
$doctor = Join-Path $projectRoot 'scripts\doctor.mjs'
$checkOutput = & $node.Source $doctor --json --mode install --python $Python
$checkCode = $LASTEXITCODE
try { $report = ($checkOutput -join [Environment]::NewLine) | ConvertFrom-Json }
catch { Write-Host 'DOCTOR_FAILED：环境诊断未完成；没有开始安装。请运行 Check-Companion.cmd。'; exit 2 }
if ($Json) { $report | ConvertTo-Json -Depth 12 }
else {
    Write-Host "安装前检查：$($report.status)"
    foreach ($action in $report.next_actions) { Write-Host $action }
}
if ($checkCode -ne 0 -or -not $report.capabilities.install_ready) { exit 2 }
if ($CheckOnly) { exit 0 }
if ($Json) { Write-Host '开始依赖安装；阶段过程由现有脚本输出。需要机器可读的只读结果请使用 -CheckOnly -Json。' }
try {
    if ($Phase -in @('All', 'Harness')) {
        Write-Host '[1/2] 根依赖、固定 Harness、当前人物 UI、原插件与文件序列化'
        $npm = Get-Command npm.cmd -ErrorAction Stop
        & $npm.Source ci --ignore-scripts --no-audit --no-fund --prefix $projectRoot
        if ($LASTEXITCODE -ne 0) { throw 'ROOT_DEPENDENCIES_INSTALL_FAILED' }
        & (Join-Path $projectRoot 'Setup-Harness.ps1')
        if ($LASTEXITCODE -ne 0) { throw 'HARNESS_INSTALL_FAILED' }
        & (Join-Path $projectRoot 'Setup-Files.ps1') -Python $Python
        if ($LASTEXITCODE -ne 0) { throw 'FILE_SERIALIZER_INSTALL_FAILED' }
    }
    if ($Phase -in @('All', 'Voice')) {
        Write-Host '[2/2] 原 VoiceBridge Python 依赖；不下载模型、不安装驱动'
        & (Join-Path $projectRoot 'integrations\voice-bridge\setup.ps1') -Python $Python
        if ($LASTEXITCODE -ne 0) { throw 'BRIDGE_INSTALL_FAILED' }
    }
} catch {
    Write-Host 'COMPANION_INSTALL_FAILED：依赖阶段未完成。现有配置和服务保留；查看上方阶段错误，修复后用 -Phase Harness 或 -Phase Voice 重试。'
    exit 2
}
Write-Host '依赖阶段完成。尚未下载原模型、授权预算或启动任何服务。'
Write-Host '下一步：npm run configure；按 integrations/voice-bridge/README.md 安装并核验原模型；运行 Check-Companion.cmd。'
& $node.Source $doctor --text --python $Python
# A missing private approval/model is a next setup step, not a failed dependency install.
exit 0
