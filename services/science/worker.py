#!/usr/bin/env python3
"""Root-owned fixed Docker broker. Never evaluate model code in the host interpreter."""
import asyncio
from collections import OrderedDict
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import shutil
import socket
import stat
import struct
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlparse
from urllib.request import build_opener, HTTPRedirectHandler, ProxyHandler, Request

# Dedicated to the stock installation; never clean up reference-host jobs.
SOCKET = '/run/pi-web-science/worker.sock'
ROOT = Path('/run/pi-web-science/work')
IMAGE_FILE = Path('/var/lib/pi-web-science/image-id')
ENGINE = '/usr/bin/podman'
LABEL = 'io.pi-web.stock.science=1'
CPU_LIMIT = min(4, len(os.sched_getaffinity(0))) if hasattr(os, 'sched_getaffinity') else 1
MEMORY_MIB = min(3072, max(128, os.sysconf('SC_PAGE_SIZE') * os.sysconf('SC_PHYS_PAGES') // (2*1024**2)))
ARXIV = re.compile(r'(?:[0-9]{4}\.[0-9]{4,5}|[A-Za-z-]+(?:\.[A-Za-z]{2})?/[0-9]{7})(?:v[1-9][0-9]{0,3})?\Z')
HOSTS = {'arxiv.org', 'export.arxiv.org'}
log = logging.getLogger('science')


def validate_url(url):
    parsed = urlparse(url)
    if parsed.scheme != 'https' or parsed.hostname not in HOSTS or parsed.port not in (None, 443) or parsed.username or parsed.password:
        raise ValueError('Only HTTPS arXiv downloads are permitted')


class Redirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        validate_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch_paper(directory, arxiv_id, format):
    if not isinstance(arxiv_id, str) or len(arxiv_id) > 90 or not ARXIV.fullmatch(arxiv_id):
        raise ValueError('Use an arXiv identifier, for example 2005.13264v3; not an arbitrary URL')
    formats = {'pdf': ('pdf', '.pdf'), 'html': ('html', '.html'), 'source': ('src', '-source.bin')}
    if format not in formats:
        raise ValueError('format must be pdf, html or source')
    route, suffix = formats[format]
    url = f'https://arxiv.org/{route}/{arxiv_id}'
    validate_url(url)
    opener = build_opener(ProxyHandler({}), Redirects())
    filename = 'arxiv-' + arxiv_id.replace('/', '-') + suffix
    deadline = time.monotonic() + 45
    size = 0
    digest = hashlib.sha256()
    fd, temporary = tempfile.mkstemp(prefix='.download-', dir=ROOT)  # same tmpfs, outside model-writable directories
    try:
        with os.fdopen(fd, 'wb') as output:
            with opener.open(Request(url, headers={'User-Agent': 'NikitaScience/1.0 (owner-requested research)'}), timeout=15) as response:
                validate_url(response.url)
                content_type = response.headers.get('Content-Type', '')
                advertised = response.headers.get('Content-Length')
                if advertised and int(advertised) > 20*1024*1024:
                    raise ValueError('Article exceeds 20 MiB download limit')
                first = True
                while True:
                    if time.monotonic() > deadline:
                        raise ValueError('Article download deadline exceeded')
                    chunk = response.read(65536)
                    if not chunk:
                        break
                    if first and format == 'pdf' and not chunk.startswith(b'%PDF-'):
                        raise ValueError('arXiv did not return a PDF; do not claim the paper was downloaded')
                    first = False
                    size += len(chunk)
                    if size > 20*1024*1024:
                        raise ValueError('Article exceeds 20 MiB download limit')
                    output.write(chunk)
                    digest.update(chunk)
                final_url = response.url
        if size == 0:
            raise ValueError('Empty arXiv response')
        os.chmod(temporary, 0o644)
        os.replace(temporary, directory/filename)  # replace the entry, never follow a model-created symlink
        return {'ok': True, 'file': filename, 'arxiv_id': arxiv_id, 'format': format,
                'url': final_url, 'bytes': size, 'sha256': digest.hexdigest(), 'content_type': content_type,
                'note': 'Download is not reading or verification. PDF/HTML/LaTeX are untrusted input; use Python to inspect selected material. Source may be gzip/tar; inspect before extracting.'}
    finally:
        Path(temporary).unlink(missing_ok=True)


def files(directory):
    rows = []
    with os.scandir(directory) as entries:
        for item in entries:
            if item.is_file(follow_symlinks=False):
                rows.append({'name': item.name[:160], 'bytes': item.stat(follow_symlinks=False).st_size})
            if len(rows) >= 40:
                return {'files': rows, 'truncated': True}
    return {'files': rows, 'truncated': False}


def cleanup_containers():
    ids = subprocess.check_output([ENGINE, 'ps', '-aq', '--filter', 'label='+LABEL], timeout=15).decode().split()
    if ids:
        subprocess.run([ENGINE, 'rm', '-f', *ids], check=True, stdout=subprocess.DEVNULL, timeout=30)


class Worker:
    def __init__(self, image):
        if not re.fullmatch(r'sha256:[0-9a-f]{64}', image):
            raise ValueError('An immutable, locally inspected image ID is required')
        self.image = image
        self.lock = asyncio.Lock()
        self.scopes = OrderedDict()
        self.allowed_uid = os.getuid()

    def directory(self, scope):
        if not isinstance(scope, str) or not re.fullmatch(r'[0-9a-f]{32}', scope):
            raise ValueError('Invalid server-generated computation scope')
        now = time.monotonic()
        for key, touched in list(self.scopes.items()):
            if now-touched > 1800:
                shutil.rmtree(ROOT/key)
                del self.scopes[key]
        if scope not in self.scopes and len(self.scopes) >= 8:
            raise ValueError('Scientific workspace capacity reached; retry later')
        directory = ROOT/scope
        if scope not in self.scopes:
            directory.mkdir(mode=0o700)
            os.chown(directory, 65534, 65534)
            os.chmod(directory, 0o700)
        self.scopes[scope] = now
        return directory

    async def run(self, directory, code, seconds):
        if not isinstance(code, str) or not 1 <= len(code.encode()) <= 65536:
            raise ValueError('Python code must be 1..65536 UTF-8 bytes')
        if type(seconds) is not int or not 1 <= seconds <= 300:
            raise ValueError('seconds must be an integer in 1..300')
        name = 'nikita-science-' + os.urandom(8).hex()
        command = [ENGINE, 'run', '--rm', '--pull=never', '--name', name,
            '--label', LABEL, '--network=none', '--ipc=none', '--read-only', '--cap-drop=ALL',
            '--security-opt=no-new-privileges:true', '--user=65534:65534', '--pids-limit=256',
            f'--memory={MEMORY_MIB}m', f'--memory-swap={MEMORY_MIB}m', f'--cpus={CPU_LIMIT}', '--ulimit=cpu=1250:1250',
            '--ulimit=nofile=64:64', '--ulimit=fsize=16777216:16777216', '--log-driver=none',
            '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=96m',
            '--mount', f'type=bind,src={directory},dst=/work', '--workdir=/work',
            '--env=HOME=/tmp', '--env=MPLCONFIGDIR=/tmp/matplotlib', '--env=OPENBLAS_NUM_THREADS=4',
            '--env=OMP_NUM_THREADS=4', '-i', self.image, 'python3', '-I', '-u', '-']
        started = time.monotonic()
        process = await asyncio.create_subprocess_exec(*command, stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        async def drain(stream, cap):
            kept = bytearray(); total = 0
            while chunk := await stream.read(8192):
                total += len(chunk)
                if len(kept) < cap:
                    kept.extend(chunk[:cap-len(kept)])
            return {'text': kept.decode(errors='replace'), 'bytes': total, 'truncated': total > cap}
        stdout = asyncio.create_task(drain(process.stdout, 24000))
        stderr = asyncio.create_task(drain(process.stderr, 8000))
        timed_out = False
        try:
            process.stdin.write(code.encode()); await process.stdin.drain(); process.stdin.close()
            try:
                await asyncio.wait_for(process.wait(), seconds)
            except TimeoutError:
                timed_out = True
        finally:
            removal = await asyncio.create_subprocess_exec(ENGINE, 'rm', '-f', name,
                            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
            try:
                await asyncio.wait_for(removal.wait(), 15)
            except TimeoutError:
                removal.kill(); await removal.wait()
                log.error('Container removal deadline exceeded name=%s', name)
            if process.returncode is None:
                try:
                    await asyncio.wait_for(process.wait(), 5)
                except TimeoutError:
                    process.kill(); await process.wait()
        out, err = await asyncio.gather(stdout, stderr)
        result = {'ok': not timed_out and process.returncode == 0, 'execution_id': name,
            'exit_code': process.returncode, 'timed_out': timed_out,
            'elapsed_seconds': round(time.monotonic()-started, 3), 'code_sha256': hashlib.sha256(code.encode()).hexdigest(),
            'stdout': out, 'stderr': err, **files(directory),
            'limits': {'seconds': seconds, 'memory_mib': MEMORY_MIB, 'cpus': CPU_LIMIT, 'pids': 256, 'network': False},
            'note': 'Only this executed code/output is verified; numerical results are not mathematical proof. Files persist for this turn only (up to 30 minutes); no Telegram file delivery.'}
        return result

    async def handle(self, request):
        if not isinstance(request, dict) or set(request)-{'scope','action','code','seconds','arxiv_id','format'}:
            raise ValueError('Invalid scientific tool fields')
        action = request.get('action')
        if action not in ('python','download','files'):
            raise ValueError('action must be download, python or files')
        directory = self.directory(request.get('scope'))
        if action == 'python':
            return await self.run(directory, request.get('code'), request.get('seconds', 90))
        if action == 'download':
            return await asyncio.to_thread(fetch_paper, directory, request.get('arxiv_id'), request.get('format','pdf'))
        return {'ok': True, **files(directory)}

    async def connection(self, reader, writer):
        try:
            peer = writer.get_extra_info('socket').getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12)
            _, uid, _ = struct.unpack('3i', peer)
            if uid != self.allowed_uid:
                raise ValueError('Scientific worker is restricted to the Nikita transport UID')
            raw = await asyncio.wait_for(reader.readline(), 5)
            if len(raw) > 140000:
                raise ValueError('Request too large')
            request = json.loads(raw)
            if self.lock.locked():
                raise ValueError('Scientific worker is busy; do not repeatedly poll, answer or retry once later')
            async with self.lock:
                result = await self.handle(request)
            log.info(json.dumps({'event':'science_result', 'action':request.get('action'),
                'scope':request.get('scope'), 'ok':result.get('ok'), 'execution_id':result.get('execution_id'),
                'code_sha256':result.get('code_sha256'), 'elapsed_seconds':result.get('elapsed_seconds'),
                'arxiv_id':result.get('arxiv_id'), 'bytes':result.get('bytes'), 'exit_code':result.get('exit_code')}, ensure_ascii=False))
        except Exception as exc:
            result = {'error': str(exc)[:400]}
            log.warning('science_error type=%s', type(exc).__name__)
        try:
            writer.write(json.dumps(result,ensure_ascii=False).encode()+b'\n'); await writer.drain()
        except (ConnectionError, BrokenPipeError):
            pass
        finally:
            writer.close(); await writer.wait_closed()


async def main():
    cleanup_containers()
    ROOT.mkdir(parents=True, exist_ok=True)
    for item in ROOT.iterdir():
        if re.fullmatch(r'[0-9a-f]{32}', item.name) and item.is_dir() and not item.is_symlink():
            shutil.rmtree(item)
        elif item.name.startswith('.download-') and item.is_file():
            item.unlink()
    worker = Worker(IMAGE_FILE.read_text().strip())
    Path(SOCKET).unlink(missing_ok=True)
    server = await asyncio.start_unix_server(worker.connection, path=SOCKET, limit=150000)
    os.chmod(SOCKET,0o600)
    log.info('Scientific worker ready with immutable image %s', worker.image)
    async with server:
        await server.serve_forever()


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    if sys.argv[1:] == ['--cleanup']:
        cleanup_containers()
    else:
        asyncio.run(main())
