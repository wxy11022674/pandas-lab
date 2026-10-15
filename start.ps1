param([switch]$SkipInstall)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 22.12+ is required.' }
if (-not (Test-Path -LiteralPath '.venv\Scripts\python.exe')) {
    if (-not (Get-Command python -ErrorAction SilentlyContinue)) { throw 'Python 3.11+ is required.' }
    & python -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'Could not create Python virtual environment.' }
}
$taskPython = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not $SkipInstall) {
    & $taskPython -m pip install -r backend/requirements.txt
    if ($LASTEXITCODE -ne 0) { throw 'Python dependency installation failed.' }
    & npm.cmd install
    if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' }
}
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
Write-Host ''
Write-Host 'Pandas Lab is starting at http://127.0.0.1:8000' -ForegroundColor Green
Write-Host 'Open this address in your browser. Press Ctrl+C to stop.'
& $taskPython -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
