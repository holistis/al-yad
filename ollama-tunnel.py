"""
YAD Ollama-tunnel — start dit script om verbinding te maken met de Frankfurt server.
Zolang dit venster open staat, is Ollama bereikbaar op localhost:11434.
"""
import paramiko
import socket
import threading
import sys

HOST      = "138.201.204.97"
USER      = "root"
KEY_FILE  = r"C:\Code\al-yad\ollama_key"
LOCAL_PORT  = 11434
REMOTE_PORT = 11434

def forward_handler(local_sock, transport):
    try:
        remote = transport.open_channel(
            "direct-tcpip",
            ("localhost", REMOTE_PORT),
            local_sock.getpeername(),
        )
    except Exception as e:
        print(f"Kanaal mislukt: {e}")
        local_sock.close()
        return

    def pump(src, dst):
        try:
            while True:
                data = src.recv(4096)
                if not data:
                    break
                dst.send(data)
        except Exception:
            pass
        finally:
            try: src.close()
            except: pass
            try: dst.close()
            except: pass

    threading.Thread(target=pump, args=(local_sock, remote), daemon=True).start()
    threading.Thread(target=pump, args=(remote, local_sock), daemon=True).start()

def main():
    print("=" * 50)
    print("YAD Ollama-tunnel")
    print(f"Verbinding: {USER}@{HOST}")
    print(f"Poort:      localhost:{LOCAL_PORT} → server:{REMOTE_PORT}")
    print("=" * 50)
    print("Verbinden...")

    key = paramiko.RSAKey.from_private_key_file(KEY_FILE)
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, pkey=key, timeout=15)
    transport = client.get_transport()

    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        server.bind(("127.0.0.1", LOCAL_PORT))
    except OSError:
        print(f"\nPoort {LOCAL_PORT} is al in gebruik.")
        print("Misschien draait de tunnel al? Sluit dan het andere venster eerst.")
        input("\nDruk Enter om te sluiten...")
        sys.exit(1)

    server.listen(10)
    print(f"\nTunnel ACTIEF op localhost:{LOCAL_PORT}")
    print("YAD kan nu Ollama gebruiken via de Frankfurt server.")
    print("\nSluit dit venster NIET — dan stopt de verbinding.")
    print("(Druk Ctrl+C om bewust te stoppen)")
    print("-" * 50)

    try:
        while True:
            conn, _ = server.accept()
            threading.Thread(
                target=forward_handler, args=(conn, transport), daemon=True
            ).start()
    except KeyboardInterrupt:
        print("\nTunnel gestopt.")
    finally:
        server.close()
        client.close()

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\nFout: {e}")
        input("Druk Enter om te sluiten...")
