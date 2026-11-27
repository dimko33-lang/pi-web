"""Fixed private IPC client for the isolated public-web worker; no Telegram state."""
import json
import socket
import sys

request = sys.stdin.buffer.read(8193)
if len(request) > 8192:
    raise ValueError('Web request is too large')
with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
    client.settimeout(52)
    client.connect('/run/nikita-web/worker.sock')
    client.sendall(request + b'\n')
    output = bytearray()
    while len(output) < 1_000_000:
        chunk = client.recv(8192)
        if not chunk:
            break
        output.extend(chunk)
        if b'\n' in chunk:
            break
json.loads(output)
sys.stdout.buffer.write(output)
