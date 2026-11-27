"""One WAV in, validated MP4 out. systemd owns the socket and session limit."""
import asyncio
import struct
import sys
import tempfile
from pathlib import Path
from circle_render import render


async def main():
    wave = sys.stdin.buffer.read(4 * 1024**2 + 1)
    if not 44 < len(wave) <= 4 * 1024**2:
        raise ValueError('Invalid speech payload size')
    with tempfile.TemporaryDirectory() as folder:
        source, target = (Path(folder) / n for n in ('speech.wav', 'circle.mp4'))
        source.write_bytes(wave)
        duration = await render(source, target)
        data = target.read_bytes()
        if len(data) > 40 * 1024**2:
            raise ValueError('Oversize circle')
        sys.stdout.buffer.write(struct.pack('!II', len(data), round(duration * 1000)) + data)


if __name__ == '__main__':
    asyncio.run(main())
