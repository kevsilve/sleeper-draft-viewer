param(
  [int]$Port = 3000
)

$listeners = netstat -ano | Select-String "LISTENING" | Select-String ":$Port\s"

if (-not $listeners) {
  Write-Host "No server is listening on port $Port."
  exit 0
}

$serverProcessIds = @()
foreach ($line in $listeners) {
  $parts = ($line.ToString().Trim() -split "\s+")
  if ($parts.Length -gt 0) {
    $serverProcessIds += [int]$parts[-1]
  }
}
$serverProcessIds = $serverProcessIds | Select-Object -Unique

foreach ($serverPid in $serverProcessIds) {
  $proc = Get-Process -Id $serverPid -ErrorAction SilentlyContinue
  if (-not $proc) {
    continue
  }

  if ($proc.ProcessName -ne "node") {
    Write-Warning "Port $Port is used by $($proc.ProcessName) (PID $serverPid), not node. Skipping."
    continue
  }

  Write-Host "Stopping draft viewer server on port $Port (PID $serverPid)..."
  Stop-Process -Id $serverPid -Force
}

Start-Sleep -Milliseconds 400
$stillListening = netstat -ano | Select-String "LISTENING" | Select-String ":$Port\s"

if ($stillListening) {
  Write-Warning "Port $Port is still in use. Try running PowerShell as Administrator, or use a different PORT."
  exit 1
}

Write-Host "Port $Port is free."
