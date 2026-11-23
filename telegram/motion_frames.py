"""Read the current Telegram clip as an ordered contact sheet, not as audio or a transcript."""
import asyncio
import io
from contextlib import asynccontextmanager
import os
from pathlib import Path
import tempfile

LIMIT = 5_000_000
TYPES = {'image/gif', 'video/mp4', 'video/webm', 'video/quicktime'}
WORKER = Path(__file__).resolve().parent / 'media-decoder' / 'frames.cjs'
SLOTS = asyncio.Semaphore(1)
NOTE = ('Silent visual samples from a Telegram attachment, chronological left to right, top row then bottom. '
        'Unused cells may be black. They are still frames, not continuous video. '
        'If you do not actually see an image, say so; do not infer its contents from this note.')


def motion_type(message):
    mime = getattr(getattr(message, 'file', None), 'mime_type', '')
    return mime if mime in TYPES else None


@asynccontextmanager
async def sampled_inputs(*messages):
    """Only call after the transport has selected the turn and checked the reply peer."""
    async def download(message, **kwargs): return await message.download_media(**kwargs)
    files, notes = [], []
    with tempfile.TemporaryDirectory(prefix='nikita-motion-') as temp:
        for msg in messages:
            if motion_type(msg):
                images, note = await sample_motion(msg, download, Path(temp))
                files.extend(images); notes.append(note)
        yield files, '\n'.join(notes)


class CappedBytes(io.BytesIO):
    def write(self, b):
        if self.tell() + len(b) > LIMIT:
            raise ValueError('Oversize')
        return super().write(b)


async def sample_motion(message, download, directory):
    mime = motion_type(message)
    if not mime: return [], ''
    if not 0 < (message.file.size or 0) <= LIMIT:
        return [], 'Clip not viewed: missing size or above the 5 MB attachment limit.'
    async with SLOTS:
        try:
            with CappedBytes() as source:
                await asyncio.wait_for(download(message, file=source), 30)
                env = {'PATH': os.environ.get('PATH', '/usr/local/bin:/usr/bin:/bin')}
                proc = await asyncio.create_subprocess_exec('node', '--max-old-space-size=96', '--wasm-max-mem-pages=3072',
                    str(WORKER), mime, env=env, stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
                try:
                    jpeg, _ = await asyncio.wait_for(proc.communicate(source.getvalue()), 20)
                finally:
                    if proc.returncode is None:
                        proc.kill(); await proc.wait()
            if proc.returncode or not jpeg.startswith(b'\xff\xd8') or len(jpeg)>1_000_000:
                raise ValueError('No frames')
            directory.mkdir(mode=0o700, parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(prefix='motion-',suffix='.jpg',dir=directory,delete=False) as output:
                try: output.write(jpeg);output.flush()
                except BaseException:
                    Path(output.name).unlink(missing_ok=True);raise
                return [Path(output.name)], NOTE
        except (ValueError, OSError, asyncio.TimeoutError):
            return [], 'Clip not viewed: unsupported, damaged, too long (120 s maximum), or decoder unavailable. Do not guess its contents.'
