# DigitalADbird CRM - Startup Script
# Run from the root of the project:  .\start.ps1

$rootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $rootDir "backend"
$frontendDir = Join-Path $rootDir "frontend"

$pgBin = Join-Path $backendDir "node_modules\@embedded-postgres\windows-x64\native\bin"
$pgData = Join-Path $backendDir "data\pgdata"
$pgCtl = Join-Path $pgBin "pg_ctl.exe"
$pgLog = Join-Path $env:TEMP "pg-digitaladbird.log"
$pgPort = 5433

Write-Host "=== DigitalADbird CRM Startup ===" -ForegroundColor Cyan

# ---- 1. Start PostgreSQL ----
Write-Host "`n[1/4] Checking PostgreSQL..." -ForegroundColor Yellow

# Check if already running
$pgStatus = & $pgCtl -D $pgData status 2>&1
if ($pgStatus -match "server is running") {
    Write-Host "  PostgreSQL already running." -ForegroundColor Green
} else {
    # Initialize if needed
    if (-not (Test-Path (Join-Path $pgData "PG_VERSION"))) {
        Write-Host "  Initializing PostgreSQL cluster..."
        Set-Location $pgBin
        & (Join-Path $pgBin "initdb.exe") -D $pgData -U postgres -A trust --no-locale --encoding=UTF8 | Out-Null
        Add-Content -Path (Join-Path $pgData "postgresql.conf") -Value "port = $pgPort"
    }

    Write-Host "  Starting PostgreSQL on port $pgPort..."
    Set-Location $pgBin
    & $pgCtl -D $pgData -l $pgLog start | Out-Null
    Start-Sleep -Seconds 3
    Write-Host "  PostgreSQL started." -ForegroundColor Green
}

# ---- 2. Create DB if needed ----
Write-Host "`n[2/4] Setting up database..." -ForegroundColor Yellow
Set-Location $backendDir

$createDbScript = @"
const { Pool } = require('pg');
async function run() {
  const pool = new Pool({ host: '127.0.0.1', port: $pgPort, user: 'postgres', database: 'postgres', ssl: false });
  try {
    await pool.query('CREATE DATABASE digitaladbird');
    console.log('Database created');
  } catch(e) {
    if (e.message.includes('already exists')) {
      console.log('Database exists');
    } else {
      console.error('DB error:', e.message);
    }
  }
  await pool.end();
}
run();
"@

node -e $createDbScript

# Run migrations
Write-Host "  Running migrations..."
node src/db/migrate.js 2>&1 | Select-String -Pattern "(APPLY|complete|ERROR)" | ForEach-Object { Write-Host "  $_" }

Write-Host "  Database ready." -ForegroundColor Green

# ---- 3. Start Backend ----
Write-Host "`n[3/4] Starting Backend (port 4000)..." -ForegroundColor Yellow
$backendProcess = Start-Process -FilePath "node" -ArgumentList "src/server.js" -WorkingDirectory $backendDir -PassThru -WindowStyle Normal
Write-Host "  Backend PID: $($backendProcess.Id)" -ForegroundColor Green
Start-Sleep -Seconds 2

# ---- 4. Start Frontend ----
Write-Host "`n[4/4] Starting Frontend (port 3000)..." -ForegroundColor Yellow
$frontendProcess = Start-Process -FilePath "npm" -ArgumentList "run", "dev" -WorkingDirectory $frontendDir -PassThru -WindowStyle Normal
Write-Host "  Frontend PID: $($frontendProcess.Id)" -ForegroundColor Green
Start-Sleep -Seconds 5

# ---- Open Browser ----
Write-Host "`n=== Opening browser ===" -ForegroundColor Cyan
Start-Process "http://localhost:3000"

Write-Host @"

=== DigitalADbird CRM is Running ===

  Frontend:  http://localhost:3000
  Backend:   http://localhost:4000
  DB Health: http://localhost:4000/health/db

=== Login Credentials ===

  Admin:   phone = +919999999999  (or 9999999999)
  Manager: phone = +919888888888  (or 9888888888)
  Member:  phone = +919777777777  (or 9777777777)

  OTP will be printed in the backend console (OTP_PROVIDER=console)

Press Ctrl+C to stop.

"@ -ForegroundColor Green

# Wait
try {
    Wait-Process -Id $backendProcess.Id
} catch {
    Write-Host "Backend stopped."
}
