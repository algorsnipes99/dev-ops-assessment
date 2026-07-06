<#
.SYNOPSIS
  Fleet Health Monitor - Windows Control Plane (PowerShell)
.DESCRIPTION
  PowerShell equivalent of ops.sh for Windows users.
  Manages Docker Compose lifecycle, feeder, seed data, snapshots, and remote diagnostics.
.EXAMPLE
  .\ops.ps1 start       # Build and boot the stack
  .\ops.ps1 status      # Container runtime health
  .\ops.ps1 seed        # Inject synthetic telemetry
  .\ops.ps1 feeder start # Start the heartbeat feeder
#>

param(
  [Parameter(Position = 0)]
  [string]$Command = "",

  [Parameter(Position = 1)]
  [string]$Filter = "",

  [switch]$Feeder = $false,

  [Parameter(Position = 2, DontShow)]
  [string]$SubAction = ""
)

# --- Constants ---------------------------------------------------------------
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ComposeFile = Join-Path $ProjectRoot "docker-compose.yml"
$EnvFile     = Join-Path $ProjectRoot ".env"
$EnvExample  = Join-Path $ProjectRoot ".env.example"
$BackupDir   = Join-Path $ProjectRoot "backups"

# --- Colored output helpers --------------------------------------------------
function Write-Info   { Write-Host "[INFO]  $($args -join ' ')" -ForegroundColor Green }
function Write-Warn   { Write-Host "[WARN]  $($args -join ' ')" -ForegroundColor Yellow }
function Write-Error  { Write-Host "[ERROR] $($args -join ' ')" -ForegroundColor Red }
function Write-Header { Write-Host "`n=== $($args -join ' ') ===" -ForegroundColor Cyan }

# --- Helper Functions --------------------------------------------------------

function Ensure-Env {
  if (-not (Test-Path $EnvFile)) {
    if (Test-Path $EnvExample) {
      Write-Warn ".env file not found - copying from .env.example"
      Copy-Item $EnvExample $EnvFile
      Write-Info "Edit $EnvFile to match your environment and re-run."
    } else {
      Write-Error "No .env or .env.example found. Create one first."
      exit 1
    }
  }
}

function Get-EnvValue {
  param([string]$Key, [string]$Default = "")
  if (Test-Path $EnvFile) {
    $line = Select-String "^${Key}=" $EnvFile -SimpleMatch | Select-Object -First 1
    if ($line) {
      return ($line.Line -split '=', 2)[1].Trim()
    }
  }
  return $Default
}

# --- Subcommands -------------------------------------------------------------

function Start-Stack {
  Write-Header "Starting Fleet Health Monitor"
  Ensure-Env

  if ($Feeder) {
    Write-Info "Building images (no cache) and starting containers (with heartbeat feeder) in detached mode..."
    docker compose -f $ComposeFile build --no-cache
    docker compose -f $ComposeFile --profile feeder up -d
  } else {
    # Tear down any leftover feeder container from a previous dev-mode run
    $existing = docker compose -f $ComposeFile --profile feeder ps -q feeder 2>$null
    if ($existing) {
      Write-Info "Removing existing feeder container (switching to production mode)..."
      docker compose -f $ComposeFile --profile feeder rm -sf feeder 2>$null
    }
    Write-Info "Building images (no cache) and starting containers (database + app only) in detached mode..."
    docker compose -f $ComposeFile build --no-cache
    docker compose -f $ComposeFile up -d
  }

  if ($LASTEXITCODE -eq 0) {
    Write-Info "Containers are booting. Use '.\ops.ps1 status' to check health."
  }
}

function Stop-Stack {
  Write-Header "Stopping Fleet Health Monitor"
  Write-Info "Gracefully bringing down workloads and cleaning up networks..."
  docker compose -f $ComposeFile down --remove-orphans
  if ($LASTEXITCODE -eq 0) {
    Write-Info "All containers stopped and networks removed."
  }
}

function Restart-Stack {
  Write-Header "Restarting Fleet Health Monitor"
  Stop-Stack
  Start-Stack
}

function Get-Status {
  Write-Header "Container Runtime Status"
  docker compose -f $ComposeFile ps
}

function Get-Logs {
  if ($Filter) {
    Write-Info "Filtering logs for: $Filter"
    docker compose -f $ComposeFile logs --tail=100 -f 2>&1 | Select-String $Filter
  } else {
    docker compose -f $ComposeFile logs --tail=50 -f
  }
}

function Invoke-Feeder {
  switch ($SubAction.ToLower()) {
    "start" {
      Write-Header "Starting Heartbeat Feeder"
      docker compose -f $ComposeFile --profile feeder up --build -d feeder
      if ($LASTEXITCODE -eq 0) {
        Write-Info "Feeder is running. Use '.\ops.ps1 logs -Filter feeder' to see heartbeats."
      }
    }
    "stop" {
      Write-Header "Stopping Heartbeat Feeder"
      docker compose -f $ComposeFile stop feeder
      if ($LASTEXITCODE -eq 0) {
        Write-Info "Feeder stopped."
      }
    }
    "restart" {
      Write-Header "Restarting Heartbeat Feeder"
      docker compose -f $ComposeFile stop feeder
      docker compose -f $ComposeFile --profile feeder up --build -d feeder
    }
    "logs" {
      Write-Header "Heartbeat Feeder Logs"
      docker compose -f $ComposeFile logs --tail=50 -f feeder
    }
    "status" {
      Write-Header "Heartbeat Feeder Status"
      docker compose -f $ComposeFile ps feeder
    }
    default {
      Write-Host @"
Usage: .\ops.ps1 feeder <start|stop|restart|logs|status>

  start     Build and start the continuous heartbeat feeder container.
  stop      Stop the feeder container without affecting app/database.
  restart   Cycle the feeder (stop + start).
  logs      Tail feeder logs (heartbeat output).
  status    Show feeder container runtime status.

The feeder simulates fleet hosts sending telemetry every N seconds.
Configure via .env: FEEDER_INTERVAL, FEEDER_HOSTS, FEEDER_EVENTS
"@
    }
  }
}

function Invoke-Seed {
  Write-Header "Seeding Synthetic Metrics"
  Ensure-Env

  $port = Get-EnvValue "PORT" "3000"
  $baseUrl = "http://localhost:$port"

  # Wait for the app to be ready
  Write-Info "Waiting for application to be ready at $baseUrl..."
  $ready = $false
  for ($i = 1; $i -le 30; $i++) {
    try {
      $response = Invoke-WebRequest -Uri "$baseUrl/health" -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -eq 200) {
        $ready = $true
        Write-Info "Application is ready."
        break
      }
    } catch {
      # Not ready yet
    }
    if ($i -eq 30) {
      Write-Error "Application did not become ready in time. Is it running?"
      exit 1
    }
    Start-Sleep -Seconds 2
  }

  $timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

  Write-Info "Injecting telemetry payloads for multiple mock hosts..."

  # Host: api-01 - All services healthy
  $body = @{
    host       = "api-01"
    timestamp  = $timestamp
    cpu_load   = 0.42
    mem_used_mb = 2048
    services   = @(
      @{ name = "nginx"; healthy = $true },
      @{ name = "node-app"; healthy = $true },
      @{ name = "redis-cache"; healthy = $true }
    )
    ip = "10.0.1.10"
  } | ConvertTo-Json
  Invoke-RestMethod -Uri "${baseUrl}/ingest" -Method Post -Body $body -ContentType "application/json" -UseBasicParsing | Out-Null
  Write-Info "api-01 seeded (healthy)"
  Start-Sleep -Milliseconds 500

  # Host: api-02 - One service unhealthy
  $body = @{
    host       = "api-02"
    timestamp  = $timestamp
    cpu_load   = 0.87
    mem_used_mb = 4096
    services   = @(
      @{ name = "nginx"; healthy = $true },
      @{ name = "node-app"; healthy = $false },
      @{ name = "sidekiq-worker"; healthy = $true }
    )
    ip = "10.0.1.11"
  } | ConvertTo-Json
  Invoke-RestMethod -Uri "${baseUrl}/ingest" -Method Post -Body $body -ContentType "application/json" -UseBasicParsing | Out-Null
  Write-Info "api-02 seeded (unhealthy - node-app down)"
  Start-Sleep -Milliseconds 500

  # Host: web-01 - All services healthy
  $body = @{
    host       = "web-01"
    timestamp  = $timestamp
    cpu_load   = 0.15
    mem_used_mb = 1024
    services   = @(
      @{ name = "apache2"; healthy = $true },
      @{ name = "php-fpm"; healthy = $true }
    )
    ip = "10.0.2.20"
  } | ConvertTo-Json
  Invoke-RestMethod -Uri "${baseUrl}/ingest" -Method Post -Body $body -ContentType "application/json" -UseBasicParsing | Out-Null
  Write-Info "web-01 seeded (healthy)"
  Start-Sleep -Milliseconds 500

  # Host: db-01 - All services healthy
  $body = @{
    host       = "db-01"
    timestamp  = $timestamp
    cpu_load   = 0.63
    mem_used_mb = 8192
    services   = @(
      @{ name = "postgresql"; healthy = $true },
      @{ name = "pgbouncer"; healthy = $true },
      @{ name = "wal-g"; healthy = $true }
    )
    ip = "10.0.3.30"
  } | ConvertTo-Json
  Invoke-RestMethod -Uri "${baseUrl}/ingest" -Method Post -Body $body -ContentType "application/json" -UseBasicParsing | Out-Null
  Write-Info "db-01 seeded (healthy)"
  Start-Sleep -Milliseconds 500

  # Host: worker-01 - Multiple services unhealthy
  $body = @{
    host       = "worker-01"
    timestamp  = $timestamp
    cpu_load   = 0.95
    mem_used_mb = 6144
    services   = @(
      @{ name = "celery-worker"; healthy = $false },
      @{ name = "rabbitmq"; healthy = $true },
      @{ name = "redis"; healthy = $false }
    )
    ip = "10.0.4.40"
  } | ConvertTo-Json
  Invoke-RestMethod -Uri "${baseUrl}/ingest" -Method Post -Body $body -ContentType "application/json" -UseBasicParsing | Out-Null
  Write-Info "worker-01 seeded (unhealthy - celery-worker and redis down)"
  Start-Sleep -Milliseconds 500

  # Host: api-01 - Second (newer) heartbeat to test latest-record logic
  $body = @{
    host       = "api-01"
    timestamp  = $timestamp
    cpu_load   = 0.55
    mem_used_mb = 2304
    services   = @(
      @{ name = "nginx"; healthy = $true },
      @{ name = "node-app"; healthy = $true },
      @{ name = "redis-cache"; healthy = $true }
    )
    ip = "10.0.1.10"
  } | ConvertTo-Json
  Invoke-RestMethod -Uri "${baseUrl}/ingest" -Method Post -Body $body -ContentType "application/json" -UseBasicParsing | Out-Null
  Write-Info "api-01 updated (second heartbeat)"

  Write-Host ""

  # --- Event Signals ---
  Write-Header "Injecting Error/Incident Event Signals"

  $timestamp2 = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

  # api-02 error event
  $body = @{
    host      = "api-02"
    timestamp = $timestamp2
    type      = "error"
    message   = "upstream timeout contacting db"
  } | ConvertTo-Json
  Invoke-RestMethod -Uri "${baseUrl}/events" -Method Post -Body $body -ContentType "application/json" -UseBasicParsing | Out-Null
  Write-Info "api-02 error event sent"
  Start-Sleep -Milliseconds 500

  # worker-01 warning event
  $body = @{
    host      = "worker-01"
    timestamp = $timestamp2
    type      = "warning"
    message   = "memory usage above 90% threshold"
  } | ConvertTo-Json
  Invoke-RestMethod -Uri "${baseUrl}/events" -Method Post -Body $body -ContentType "application/json" -UseBasicParsing | Out-Null
  Write-Info "worker-01 warning event sent"

  Write-Host ""
  Write-Info "Seed complete! Ingested metrics for 5 hosts plus 2 event signals."
  Write-Info "Try: curl http://localhost:${port}/fleet"
  Write-Info "  Or: curl http://localhost:${port}/host/api-02"
}

function Invoke-Remote {
  Write-Header "Remote Host Diagnostic"

  $sshHost = Get-EnvValue "SSH_HOST" ""
  $sshUser = Get-EnvValue "SSH_USER" ""
  $sshKey  = Get-EnvValue "SSH_KEY_PATH" ""

  if (-not $sshHost -or -not $sshUser) {
    Write-Warn "SSH_HOST and/or SSH_USER not set in .env - running dry-run diagnostic."
    Write-Host ""
    Write-Host "  To enable remote diagnostics, add to your .env:"
    Write-Host "    SSH_HOST=your-server.example.com"
    Write-Host "    SSH_USER=ubuntu"
    Write-Host "    SSH_KEY_PATH=/path/to/private/key (optional)"
    Write-Host ""
    Write-Host "  Dry-run: would execute 'docker ps' on remote host via SSH."
    Write-Host "  Command: ssh ${sshUser}@${sshHost} 'docker ps --format ...'"
    return
  }

  Write-Info "Running 'docker ps' on ${sshUser}@${sshHost}..."
  if ($sshKey) {
    ssh -i $sshKey "${sshUser}@${sshHost}" 'docker ps --format "table {{.ID}}\t{{.Image}}\t{{.Status}}\t{{.Names}}"'
  } else {
    ssh "${sshUser}@${sshHost}" 'docker ps --format "table {{.ID}}\t{{.Image}}\t{{.Status}}\t{{.Names}}"'
  }

  if ($LASTEXITCODE -eq 0) {
    Write-Info "Remote diagnostic completed successfully."
  } else {
    Write-Error "Remote diagnostic failed. Check SSH credentials and network connectivity."
    exit 1
  }
}

function Invoke-Snapshot {
  Write-Header "Database Snapshot (Backup)"

  # Ensure backup directory exists
  New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

  $dbHost = Get-EnvValue "DB_HOST" "localhost"
  $dbPort = Get-EnvValue "DB_PORT" "5432"
  $dbName = Get-EnvValue "DB_NAME" "fleet_health"
  $dbUser = Get-EnvValue "DB_USER" "fleet_user"
  $dbPass = Get-EnvValue "DB_PASSWORD" "fleet_pass"

  $snapshotFile = Join-Path $BackupDir "fleet_health_$(Get-Date -Format 'yyyyMMdd_HHmmss').sql"

  Write-Info "Dumping database '$dbName' to snapshot file..."

  # Set password via env var for pg_dump
  $env:PGPASSWORD = $dbPass
  pg_dump -h $dbHost -p $dbPort -U $dbUser -d $dbName --format=custom --no-owner --verbose -f $snapshotFile
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue

  if (Test-Path $snapshotFile) {
    $size = (Get-Item $snapshotFile).Length
    $sizeStr = if ($size -gt 1MB) { "{0:N2} MB" -f ($size / 1MB) } else { "{0:N2} KB" -f ($size / 1KB) }
    Write-Info "Snapshot saved: $snapshotFile ($sizeStr)"
  } else {
    Write-Error "Snapshot failed - file not created."
    exit 1
  }
}

function Show-Usage {
  Write-Host @"
Usage: .\ops.ps1 <subcommand> [options]

Subcommands:

  start         Build images and boot the multi-container stack (detached).
                Use 'start -Feeder' to also include the heartbeat simulator.
  stop          Gracefully stop containers and clean up networks.
  restart       Cycle the application (stop + start).
  status        Query runtime health of active containers.
  logs          Tail aggregated logs (both DB and app).
                Use -Filter <host_string> to filter.
  feeder        Manage the continuous heartbeat feeder container.
                Subcommands: start, stop, restart, logs, status
  seed          Inject diverse synthetic telemetry metrics.
  snapshot      Run pg_dump to save database backup to local filesystem.
  remote        Run 'docker ps' diagnostic on a remote host via SSH.
                Requires SSH_HOST and SSH_USER in .env.
                Runs dry-run safely without credentials.

Examples:
  .\ops.ps1 start
  .\ops.ps1 start -Feeder
  .\ops.ps1 logs -Filter "api-01"
  .\ops.ps1 feeder start
  .\ops.ps1 feeder logs
  .\ops.ps1 seed
  .\ops.ps1 snapshot
  .\ops.ps1 remote
"@
}

# --- Main Entry Point --------------------------------------------------------

switch ($Command.ToLower()) {
  "start"    { Start-Stack }
  "stop"     { Stop-Stack }
  "restart"  { Restart-Stack }
  "status"   { Get-Status }
  "logs"     { Get-Logs }
  "feeder"   { Invoke-Feeder }
  "seed"     { Invoke-Seed }
  "snapshot" { Invoke-Snapshot }
  "remote"   { Invoke-Remote }
  "help"     { Show-Usage }
  "-h"       { Show-Usage }
  "--help"   { Show-Usage }
  default {
    if ($Command) {
      Write-Error "Unknown subcommand: $Command"
    }
    Show-Usage
  }
}