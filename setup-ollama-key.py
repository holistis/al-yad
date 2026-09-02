import paramiko

host = '138.201.204.97'
user = 'root'
pw   = '7r%JKkx8XxGa2c'

pub_path = r'C:\Code\al-yad\ollama_key.pub'
with open(pub_path) as f:
    pubkey = f.read().strip()

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(host, username=user, password=pw, timeout=15)

cmd = 'mkdir -p ~/.ssh && echo "' + pubkey + '" >> ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys && echo OK'
_, out, err = client.exec_command(cmd)
print(out.read().decode().strip())
e = err.read().decode().strip()
if e:
    print('ERR:', e)
client.close()
