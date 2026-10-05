$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$previewUrl = 'http://127.0.0.1:8793'
$nodeExe = (Get-Command node -ErrorAction Stop).Source
# Reuse the independently approved installed model/environment. Never downloads.
$asrPython = if ($env:COMPANION_ASR_PYTHON) { $env:COMPANION_ASR_PYTHON } else { $null }
$asrExisting = Get-NetTCPConnection -LocalPort 8795 -State Listen -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path (Join-Path $projectRoot 'logs') -Force | Out-Null
if (-not $asrExisting -and $asrPython -and $env:COMPANION_WHISPER_MODEL -and (Test-Path -LiteralPath $asrPython)) {
  Start-Process -FilePath $asrPython -ArgumentList '-u', ('"' + (Join-Path $projectRoot 'server\whisper_http.py') + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $projectRoot 'logs/whisper-http.stdout.log') -RedirectStandardError (Join-Path $projectRoot 'logs/whisper-http.stderr.log')
}
$existing = Get-NetTCPConnection -LocalPort 8793 -State Listen -ErrorAction SilentlyContinue
if ($existing) {
  $status = Invoke-RestMethod "$previewUrl/api/status" -TimeoutSec 3
  if ($status.app -ne 'companion-agent-preview') { throw 'Port 8793 belongs to another application.' }
} else {
  New-Item -ItemType Directory -Path (Join-Path $projectRoot 'logs') -Force | Out-Null
  Start-Process -FilePath $nodeExe -ArgumentList 'server/app.mjs' -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $projectRoot 'logs/server.log') -RedirectStandardError (Join-Path $projectRoot 'logs/server-error.log')
  for ($i=0;$i -lt 20;$i++) { Start-Sleep -Milliseconds 250; try { $status=Invoke-RestMethod "$previewUrl/api/status" -TimeoutSec 1; if($status.app -eq 'companion-agent-preview'){break} } catch {} }
  if ($status.app -ne 'companion-agent-preview') { throw 'Preview failed to start. See logs.' }
}
Start-Process $previewUrl
Write-Output "Preview ready: $previewUrl"
