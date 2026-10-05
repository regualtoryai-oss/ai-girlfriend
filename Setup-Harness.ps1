$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$sourceRoot = Join-Path $projectRoot 'vendor\deepseek-harness-0.1.3-alpha.1'
$expectedCommit = 'd347e703908d0406b7a7ef80e3a0e594d86b2215'
$nodeExe = (Get-Command node -ErrorAction Stop).Source
$npmExe = (Get-Command npm.cmd -ErrorAction Stop).Source
if ([int]((& $nodeExe --version).TrimStart('v').Split('.')[0]) -lt 24) { throw 'Node.js 24 or newer is required.' }
if (-not (Test-Path -LiteralPath $sourceRoot)) {
  git clone --depth 1 --branch dsh-v0.1.3-alpha.1 https://github.com/deepseek-ai/deepseek-harness.git $sourceRoot
  if ($LASTEXITCODE -ne 0) { throw 'Official source download failed.' }
}
$actualCommit = git -C $sourceRoot rev-parse HEAD
if ($actualCommit -ne $expectedCommit) { throw 'Existing checkout differs from the pinned version; it has not been changed.' }
$pnpmFile = Join-Path $projectRoot 'build-tools\node_modules\pnpm\bin\pnpm.cjs'
if (-not (Test-Path -LiteralPath $pnpmFile)) {
  & $npmExe install --prefix (Join-Path $projectRoot 'build-tools') --ignore-scripts --no-audit --no-fund pnpm@11.7.0 --registry=https://registry.npmjs.org --cache (Join-Path $projectRoot 'cache\npm')
  if ($LASTEXITCODE -ne 0) { throw 'Pinned build-tool installation failed.' }
}
$previousBuildPath = $env:Path
$env:Path = (Join-Path $projectRoot 'build-tools\node_modules\.bin') + [IO.Path]::PathSeparator + $previousBuildPath
Push-Location $sourceRoot
try {
  $prepared = Test-Path -LiteralPath (Join-Path $sourceRoot '.companion-author-prepared.json')
  if (-not $prepared) {
    git diff --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Existing Harness tracked files differ. Setup has not overwritten them; use a clean pinned checkout.' }
    # Install upstream's unchanged frozen graph first. No new versions are resolved.
    & $nodeExe $pnpmFile install --frozen-lockfile --ignore-scripts --store-dir (Join-Path $projectRoot 'cache\pnpm-store') --reporter append-only
    if ($LASTEXITCODE -ne 0) { throw 'Frozen upstream dependency installation failed.' }
  }
  & $nodeExe (Join-Path $projectRoot 'integrations\harness\prepare.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'Current author UI restoration failed.' }
  # The added UI uses only existing locked versions and workspace links, with no resolver pass.
  & $nodeExe (Join-Path $projectRoot 'integrations\harness\augment-lock.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'Local author workspace lock update failed.' }
  & $nodeExe (Join-Path $projectRoot 'integrations\harness\verify-lock.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'Locked upstream package resolutions changed; setup stopped.' }
  & $nodeExe $pnpmFile install --frozen-lockfile --ignore-scripts --store-dir (Join-Path $projectRoot 'cache\pnpm-store') --reporter append-only
  if ($LASTEXITCODE -ne 0) { throw 'Frozen dependency installation failed.' }
  # This reviewed native dependency is required by alpha.1 session persistence.
  # Existing Python and Visual Studio C++ Build Tools are prerequisites on Windows.
  & $nodeExe $pnpmFile --recursive rebuild fs-ext --reporter append-only
  if ($LASTEXITCODE -ne 0) { throw 'fs-ext native build failed; inspect the compiler output.' }
  & $nodeExe $pnpmFile run build
  if ($LASTEXITCODE -ne 0) { throw 'Pinned Harness and current author UI build failed.' }
} finally { Pop-Location; $env:Path = $previousBuildPath }
& $npmExe ci --ignore-scripts --prefix (Join-Path $projectRoot 'packages\jev-plugin')
if ($LASTEXITCODE -ne 0) { throw 'Jev dependencies failed.' }
& $npmExe ci --ignore-scripts --prefix (Join-Path $projectRoot 'packages\voice-plugin')
if ($LASTEXITCODE -ne 0) { throw 'Voice dependencies failed.' }
& $nodeExe (Join-Path $projectRoot 'dsh\alpha1\register-plugins.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Official plugin registration failed.' }
& $nodeExe (Join-Path $projectRoot 'dsh\author\setup-author.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Current author profile registration failed.' }
& $nodeExe (Join-Path $projectRoot 'dsh\alpha1\run-proof.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Keyless Harness runtime verification failed.' }
Write-Output 'Pinned Harness alpha.1 and current Xiaowan author UI are ready. No provider request was made. Install the Voice Bridge separately with integrations/voice-bridge/setup.ps1.'
