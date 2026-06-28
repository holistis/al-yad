# Registreert het Yad native-messaging host-manifest in het Windows-register
# voor Chrome en Edge (HKCU = alleen huidige gebruiker, geen admin nodig).
# Draai: pnpm register-host   (na pnpm setup-host)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$json = Join-Path $root "native-messaging\com.yad.companion.json"

if (-not (Test-Path $json)) {
  Write-Error "Host-manifest niet gevonden: $json. Draai eerst pnpm setup-host."
  exit 1
}

$targets = @(
  "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.yad.companion",
  "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.yad.companion"
)

foreach ($key in $targets) {
  New-Item -Path $key -Force | Out-Null
  Set-Item -Path $key -Value $json
  Write-Output "Geregistreerd: $key -> $json"
}

Write-Output "Klaar. Host: com.yad.companion"
