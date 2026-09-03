# npm-package specific variant of the monorepo's scripts/register-host.ps1.
#
# Not reused unmodified: the original computes the manifest path relative to
# its own script location inside the monorepo ($PSScriptRoot/../native-messaging),
# which resolves to somewhere inside node_modules once this runs from an
# installed npm package. setup-host-npm.mjs writes the manifest to
# ~/.yadagent/native-messaging instead, specifically so it survives a package
# reinstall, and this script has to point at that same stable location rather
# than recompute a path that would only be correct inside the monorepo.
#
# Registers the Yad native-messaging host manifest in the Windows registry
# for Chrome and Edge (HKCU = current user only, no admin required).

$ErrorActionPreference = "Stop"
$json = Join-Path $env:USERPROFILE ".yadagent\native-messaging\com.yad.companion.json"

if (-not (Test-Path $json)) {
  Write-Error "Host manifest not found: $json. Run 'npx yadagent pair' first, this script is invoked automatically as its second step on Windows."
  exit 1
}

$targets = @(
  "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.yad.companion",
  "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.yad.companion"
)

foreach ($key in $targets) {
  New-Item -Path $key -Force | Out-Null
  New-ItemProperty -Path $key -Name "(default)" -Value $json -PropertyType String -Force | Out-Null
  Write-Output "Registered: $key -> $json"
}

Write-Output "Done. Host: com.yad.companion"
