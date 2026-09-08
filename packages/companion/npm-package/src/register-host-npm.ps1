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
#
# Multi-instance: if YAD_INSTANCE is set (same value as passed to
# `npx yadagent pair`), this registers the SECOND host name
# (com.yad.companion.<instance>) instead of the default one, matching
# what setup-host-npm.mjs wrote for that instance. Without it, behaviour
# is unchanged.

$ErrorActionPreference = "Stop"

$instance = $env:YAD_INSTANCE
if ($instance) {
  $hostName = "com.yad.companion.$instance"
} else {
  $hostName = "com.yad.companion"
}

$json = Join-Path $env:USERPROFILE ".yadagent\native-messaging\$hostName.json"

if (-not (Test-Path $json)) {
  if ($instance) {
    Write-Error "Host manifest not found: $json. Run 'YAD_INSTANCE=$instance YAD_PORT=<port> npx yadagent pair' first, this script is invoked automatically as its second step on Windows."
  } else {
    Write-Error "Host manifest not found: $json. Run 'npx yadagent pair' first, this script is invoked automatically as its second step on Windows."
  }
  exit 1
}

$targets = @(
  "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName",
  "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$hostName"
)

foreach ($key in $targets) {
  New-Item -Path $key -Force | Out-Null
  New-ItemProperty -Path $key -Name "(default)" -Value $json -PropertyType String -Force | Out-Null
  Write-Output "Registered: $key -> $json"
}

Write-Output "Done. Host: $hostName"
if ($instance) {
  Write-Output "Remember: in the SECOND Chrome profile's extension settings, set 'nativeHostName' to '$hostName'."
}
