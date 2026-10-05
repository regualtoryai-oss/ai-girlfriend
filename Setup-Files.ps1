param([string]$Python='python')
$ErrorActionPreference='Stop'
$venv=Join-Path $PSScriptRoot '.venv-files'
$filePython=Join-Path $venv 'Scripts\python.exe'
if(-not (Test-Path -LiteralPath $filePython)){
  & $Python -m venv $venv
  if($LASTEXITCODE -ne 0){throw 'File serializer environment creation failed.'}
}
& $filePython -m pip install -r (Join-Path $PSScriptRoot 'requirements-files.txt')
if($LASTEXITCODE -ne 0){throw 'File serializer dependencies failed.'}
Write-Output 'Isolated file serializer ready. Voice dependencies were not changed.'
