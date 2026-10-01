$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$previewUrl = 'http://127.0.0.1:8793'
$nodeExe = (Get-Command node -ErrorAction Stop).Source
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
