"""Private fixed-command web worker, running under a separate unprivileged Unix UID."""
import asyncio
import json
import os
from pathlib import Path
import pwd
import signal
import socket
import struct

LIMIT = asyncio.Semaphore(2)

async def handle(reader, writer):
    proc = None
    try:
        peer = writer.get_extra_info('socket').getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12)
        _, uid, _ = struct.unpack('3i', peer)
        if uid not in (0, pwd.getpwnam('pi-nikita').pw_uid):
            raise ValueError('Not authorized')
        request = await asyncio.wait_for(reader.readline(), 5)
        if len(request) > 8192:
            raise ValueError('Web request is too large')
        data = json.loads(request)
        if data.get('action') not in ('web_search', 'web_read'):
            raise ValueError('Unknown web action')
        async with LIMIT:
            proc = await asyncio.create_subprocess_exec(
                '/opt/nikita-web-venv/bin/python', '/opt/nikita-web/web_worker.py',
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
                start_new_session=True,
                env={'PATH':'/usr/bin:/bin','HOME':'/var/lib/nikita-web','PLAYWRIGHT_BROWSERS_PATH':'/opt/nikita-web-browsers'})
            output, _ = await asyncio.wait_for(proc.communicate(json.dumps(data).encode()), 48)
            if proc.returncode or len(output) > 1_000_000:
                raise ValueError('Web worker failed')
            json.loads(output)
    except Exception:
        output = b'{"error":"Web service unavailable; do not claim successful verification."}'
    finally:
        if proc:
            try: os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError: pass
            await proc.wait()
    try:
        writer.write(output.rstrip(b'\n') + b'\n')
        await writer.drain()
    finally:
        writer.close()
        await writer.wait_closed()

async def main():
    address = Path('/run/nikita-web/worker.sock')
    address.unlink(missing_ok=True)
    server = await asyncio.start_unix_server(handle, str(address), limit=10000)
    address.chmod(0o660)
    async with server:
        await server.serve_forever()

if __name__ == '__main__':
    asyncio.run(main())
