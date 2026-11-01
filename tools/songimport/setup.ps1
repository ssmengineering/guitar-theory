<#
Builds the songimport environment from nothing, in tools\songimport\.venv.

    powershell -ExecutionPolicy Bypass -File tools\songimport\setup.ps1
    powershell -ExecutionPolicy Bypass -File tools\songimport\setup.ps1 -Gpu

Needs a Python 3 on the PATH to bootstrap uv; uv then fetches its own Python
3.12 into tools\songimport\.python, so the system Python's version does not
matter. Everything the tool needs at run time stays inside tools\songimport
(.python, .venv, .models): the environment then works for whoever
double-clicks Start Guitar Theory.cmd, not only for the shell that built it.
-Gpu installs the CUDA build of PyTorch (about 3 GB) so separation runs on
the graphics card in seconds instead of minutes on the CPU.

Safe to run again: it repairs an environment whose Python has gone missing
and otherwise only refreshes the packages.
#>
param([switch]$Gpu)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$venv = Join-Path $here '.venv'
$py = Join-Path $venv 'Scripts\python.exe'
$pythons = Join-Path $here '.python'

# uv keeps the interpreters it downloads here instead of under AppData.
$env:UV_PYTHON_INSTALL_DIR = $pythons

function Invoke-Uv {
    param([string[]]$UvArgs)
    & python -m uv @UvArgs
    if ($LASTEXITCODE -ne 0) { throw "uv $($UvArgs -join ' ') failed" }
}

function Find-ManagedPython {
    Get-ChildItem $pythons -Directory -Filter 'cpython-3.12.*' -ErrorAction SilentlyContinue |
        Where-Object { Test-Path (Join-Path $_.FullName 'python.exe') } |
        Sort-Object Name -Descending | Select-Object -First 1
}

function Get-ManagedPython {
    $found = Find-ManagedPython
    if ($found) { return $found }
    Write-Host "   downloading Python 3.12 into $pythons"
    # uv has been seen downloading 3.12 and then failing on its version link;
    # the interpreter is still in place afterwards, so look again before giving up.
    & python -m uv python install 3.12 *> $null
    $found = Find-ManagedPython
    if (-not $found) {
        throw "no Python 3.12 could be installed into $pythons (try: python -m uv python install 3.12)"
    }
    return $found
}

Write-Host '1. uv'
& python -m uv --version *> $null
if ($LASTEXITCODE -ne 0) {
    & python -m pip install --quiet --disable-pip-version-check uv
    if ($LASTEXITCODE -ne 0) { throw 'could not install uv; is Python on the PATH?' }
}

Write-Host '2. Python 3.12 environment'
$cfg = Join-Path $venv 'pyvenv.cfg'
if ((Test-Path $cfg) -and (Test-Path $py)) {
    # An environment whose base interpreter has disappeared (an older setup
    # kept it under AppData) is pointed at one inside this folder instead.
    $homeLine = Get-Content $cfg | Where-Object { $_ -match '^\s*home\s*=' } | Select-Object -First 1
    $base = if ($homeLine) { ($homeLine -split '=', 2)[1].Trim() } else { '' }
    if (-not $base -or -not (Test-Path (Join-Path $base 'python.exe'))) {
        $managed = Get-ManagedPython
        Write-Host "   pointing .venv at $($managed.FullName)"
        $lines = @(Get-Content $cfg) | ForEach-Object {
            if ($_ -match '^\s*home\s*=') { "home = $($managed.FullName)" } else { $_ }
        }
        [IO.File]::WriteAllLines($cfg, $lines, (New-Object System.Text.UTF8Encoding($false)))
    }
}
if (-not (Test-Path $py)) {
    $managed = Get-ManagedPython
    Invoke-Uv @('venv', $venv, '--python', (Join-Path $managed.FullName 'python.exe'), '--quiet')
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
Write-Host 'Ready. Double-click Start Guitar Theory.cmd, or import one song with:'
Write-Host "  $(Join-Path $venv 'Scripts\songimport.exe') `"track.mp3`" --pdf `"tab.pdf`""
