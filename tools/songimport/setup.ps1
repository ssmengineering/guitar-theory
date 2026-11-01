<#
Builds the songimport environment from nothing, in tools\songimport\.venv.

    powershell -ExecutionPolicy Bypass -File tools\songimport\setup.ps1
    powershell -ExecutionPolicy Bypass -File tools\songimport\setup.ps1 -Gpu

Needs a Python 3 on the PATH to bootstrap uv; uv then fetches its own Python
3.12 for the environment, so the system Python's version does not matter.
-Gpu installs the CUDA build of PyTorch (about 3 GB) so separation runs on
the graphics card in seconds instead of minutes on the CPU.
#>
param([switch]$Gpu)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$venv = Join-Path $here '.venv'
$py = Join-Path $venv 'Scripts\python.exe'

function Invoke-Uv {
    param([string[]]$UvArgs)
    & python -m uv @UvArgs
    if ($LASTEXITCODE -ne 0) { throw "uv $($UvArgs -join ' ') failed" }
}

Write-Host '1. uv'
& python -m uv --version *> $null
if ($LASTEXITCODE -ne 0) {
    & python -m pip install --quiet --disable-pip-version-check uv
    if ($LASTEXITCODE -ne 0) { throw 'could not install uv; is Python on the PATH?' }
}

Write-Host '2. Python 3.12 environment'
if (-not (Test-Path $py)) {
    & python -m uv venv $venv --python 3.12 --quiet
    if ($LASTEXITCODE -ne 0) {
        # On this machine uv downloads 3.12 but fails to create its version
        # link, then cannot find what it downloaded. Point at it directly.
        $managedRoot = Join-Path $env:APPDATA 'uv\python'
        $managed = Get-ChildItem $managedRoot -Directory -Filter 'cpython-3.12.*' -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending | Select-Object -First 1
        if (-not $managed) {
            & python -m uv python install 3.12 *> $null
            $managed = Get-ChildItem $managedRoot -Directory -Filter 'cpython-3.12.*' -ErrorAction SilentlyContinue |
                Sort-Object Name -Descending | Select-Object -First 1
        }
        if (-not $managed) { throw 'no Python 3.12 could be found or installed' }
        Invoke-Uv @('venv', $venv, '--python', (Join-Path $managed.FullName 'python.exe'), '--quiet')
    }
}

Write-Host '3. Packages'
if ($Gpu) {
    Invoke-Uv @('pip', 'install', '--python', $py, '--quiet', 'torch', 'torchaudio',
        '--index-url', 'https://download.pytorch.org/whl/cu128')
}
Invoke-Uv @('pip', 'install', '--python', $py, '--quiet', '-e', $here)

Write-Host '4. Check'
& $py -m songimport --check
if ($LASTEXITCODE -ne 0) { throw 'the environment check failed' }

Write-Host ''
Write-Host "Ready. Import a song with:"
Write-Host "  $(Join-Path $venv 'Scripts\songimport.exe') `"track.mp3`" --pdf `"tab.pdf`""
