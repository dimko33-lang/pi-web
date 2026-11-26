"""Offline integration check: scanned PDF reply, cleanup and unreadable input."""
import asyncio
import io
from pathlib import Path
import sys
from types import SimpleNamespace
from PIL import Image
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'telegram'))
from motion_frames import sampled_inputs


async def check(data, valid):
    async def download(file):
        file.write(data)
    msg = SimpleNamespace(file=SimpleNamespace(name='scan.PDF', size=len(data), mime_type='application/octet-stream'), download_media=download)
    async with sampled_inputs(None, msg) as (files, note):
        if valid:
            assert len(files) == 1 and files[0].read_bytes().startswith(b'\xff\xd8') and 'PDF: 1 pages' in note
        else:
            assert not files and 'PDF not read' in note
    assert not any(p.exists() for p in files)


if __name__ == '__main__':
    buf = io.BytesIO()
    Image.new('RGB', (120, 80), 'white').save(buf, 'PDF')
    asyncio.run(check(buf.getvalue(), True))
    asyncio.run(check(b'invalid pdf', False))
