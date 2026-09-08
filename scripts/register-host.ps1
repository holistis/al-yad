# Registreert het Yad native-messaging host-manifest in het Windows-register
# voor Chrome en Edge (HKCU = alleen huidige gebruiker, geen admin nodig).
# Draai: pnpm register-host   (na pnpm setup-host)
#
# Multi-instance: als YAD_INSTANCE gezet is (dezelfde waarde als bij
# `pnpm setup-host`), registreert dit script de TWEEDE host-naam
# (com.yad.companion.<instance>) in plaats van de standaard-naam, zodat
# beide instanties naast elkaar in het register staan.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

$instance = $env:YAD_INSTANCE
if ($instance) {
  $hostName = "com.yad.companion.$instance"
} else {
  $hostName = "com.yad.companion"
}

$json = Join-Path $root "native-messaging\$hostName.json"

if (-not (Test-Path $json)) {
  if ($instance) {
    Write-Error "Host-manifest niet gevonden: $json. Draai eerst: YAD_INSTANCE=$instance YAD_PORT=<poort> pnpm setup-host"
  } else {
    Write-Error "Host-manifest niet gevonden: $json. Draai eerst pnpm setup-host."
  }
  exit 1
}

$targets = @(
  "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName",
  "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$hostName"
)

foreach ($key in $targets) {
  New-Item -Path $key -Force | Out-Null
  Set-Item -Path $key -Value $json
  Write-Output "Geregistreerd: $key -> $json"
}

Write-Output "Klaar. Host: $hostName"
if ($instance) {
  Write-Output "Vergeet niet: zet in de extensie-instellingen van het TWEEDE Chrome-profiel 'nativeHostName' op '$hostName'."
}
