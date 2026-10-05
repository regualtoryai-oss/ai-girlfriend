param([Parameter(Mandatory = $true)][string]$ProjectRoot)
$ErrorActionPreference = 'Stop'
$result = @{ visualCpp = $false; ports = @{} }
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (Test-Path -LiteralPath $vswhere) {
    $compilers = @(& $vswhere -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -find 'VC\Tools\MSVC\**\bin\Hostx64\x64\cl.exe')
    $sdk = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows Kits\Installed Roots' -ErrorAction SilentlyContinue).KitsRoot10
    $result.visualCpp = [bool]($compilers.Count -gt 0 -and $sdk -and (Test-Path -LiteralPath (Join-Path $sdk 'Include')))
}
try { $allListeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop) }
catch { $allListeners = $null }
$expected = $ProjectRoot.Replace([char]92, [char]47).ToLowerInvariant().TrimEnd('/') + '/'
foreach ($service in @(@{name = 'host'; port = 8796; marker = '--profile author-web'}, @{name = 'voice'; port = 8765; marker = 'uvicorn voice_bridge:app'})) {
    try {
        if ($null -eq $allListeners) { throw 'PORT_READ_DENIED' }
        $listeners = @($allListeners | Where-Object LocalPort -eq $service.port)
        $state = 'free'
        if ($listeners.Count -gt 0) {
            $state = 'owned'
            foreach ($listener in $listeners) {
                $process = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $listener.OwningProcess)
                $line = $process.CommandLine
                if (-not $line) { $state = 'unknown'; break }
                if (-not $line.Contains($service.marker) -or -not $line.Replace([char]92, [char]47).ToLowerInvariant().Contains($expected)) { $state = 'foreign'; break }
            }
        }
        $result.ports[$service.name] = @{ state = $state }
    } catch { $result.ports[$service.name] = @{ state = 'unknown' } }
}
$result | ConvertTo-Json -Depth 5 -Compress
