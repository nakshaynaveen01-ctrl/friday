# Starts everything Friday needs. Run it by double-clicking "Start Friday.bat".
# Friday's phone and WhatsApp address is permanent: https://nakshay.tail727f7e.ts.net
# (Tailscale Funnel keeps it on by itself; this script only starts Friday and FreeLLMAPI.)
$dir = $PSScriptRoot
Set-Location $dir
New-Item -ItemType Directory -Force "$dir\memory" | Out-Null

function Answers($url) {
  try { Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 4 | Out-Null; return $true }
  catch { return [bool]$_.Exception.Response }   # a 401 still means "it is up"
}

# 1. FreeLLMAPI (the brain and the voice)
if (-not (Answers 'http://localhost:31415/v1/models')) {
  Write-Host 'Starting FreeLLMAPI...'
  Start-Process "$env:LOCALAPPDATA\Programs\freellmapi-desktop\FreeLLMAPI.exe"
  for ($i = 0; $i -lt 24 -and -not (Answers 'http://localhost:31415/v1/models'); $i++) { Start-Sleep 5 }
}

# 2. Friday itself
if (-not (Answers 'http://localhost:4321/')) {
  Write-Host 'Starting Friday...'
  Start-Process node -ArgumentList 'server.js' -WorkingDirectory $dir -WindowStyle Hidden
  for ($i = 0; $i -lt 10 -and -not (Answers 'http://localhost:4321/'); $i++) { Start-Sleep 2 }
}

# 3. OpenClaw bridge (WhatsApp → Friday)
if (-not (Answers 'http://localhost:4322/v1/models')) {
  Write-Host 'Starting OpenClaw bridge...'
  Start-Process node -ArgumentList 'openclaw-bridge.js' -WorkingDirectory $dir -WindowStyle Hidden
  Start-Sleep 2
}

# 4. The old temporary link is no longer used
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force

$link = 'https://nakshay.tail727f7e.ts.net'
Write-Host ''
if (Answers 'http://localhost:4321/') {
  Set-Clipboard $link
  Write-Host 'Friday is ready.' -ForegroundColor Green
  Write-Host "Phone address (never changes): $link"
} else {
  Write-Host 'Friday did not start. Check that Node is installed.' -ForegroundColor Yellow
}
