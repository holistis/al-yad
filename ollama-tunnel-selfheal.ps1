# Zelfherstellende SSH-tunnel voor Ollama (localhost:11434 -> Hetzner Frankfurt).
# Herstart de ssh-tunnel automatisch zodra hij om welke reden dan ook stopt.
$logFile = "C:\Code\al-yad\ollama-tunnel.log"

function Log($msg) {
  "$([DateTime]::Now.ToString('yyyy-MM-dd HH:mm:ss')) $msg" | Out-File -FilePath $logFile -Append -Encoding utf8
}

Log "Zelfherstel-tunnel gestart."

while ($true) {
  Log "SSH-tunnel wordt (her)start..."
  & "C:\Windows\System32\OpenSSH\ssh.exe" -N `
    -o StrictHostKeyChecking=no `
    -o ServerAliveInterval=15 `
    -o ServerAliveCountMax=3 `
    -o ExitOnForwardFailure=yes `
    -i "C:\Code\al-yad\ollama_key" `
    -L 11434:localhost:11434 `
    root@138.201.204.97
  Log "SSH-tunnel gestopt (exit code $LASTEXITCODE). Herstart over 3 seconden."
  Start-Sleep -Seconds 3
}
