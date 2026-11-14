# Starts OpenClaw gateway with XDG_CACHE_HOME set to avoid OneDrive/AppData SQLite issues.
$env:XDG_CACHE_HOME = "$env:USERPROFILE\openclaw-cache"
New-Item -ItemType Directory -Force $env:XDG_CACHE_HOME | Out-Null
Write-Host "Starting OpenClaw (cache: $env:XDG_CACHE_HOME)..."
openclaw gateway run
