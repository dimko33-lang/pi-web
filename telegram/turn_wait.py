"""Read Pi's JSON stream to completion. The watchdog measures silence, not turn duration."""
import asyncio
from dataclasses import dataclass
import json
import os
import signal
from typing import Optional

DEFAULT_IDLE_SECONDS = 1200


def idle_seconds():
    value = os.environ.get('NIKITA_PI_IDLE_SECONDS', str(DEFAULT_IDLE_SECONDS))
    if not value.isascii() or not value.isdecimal() or len(value) > 7:
        raise ValueError('NIKITA_PI_IDLE_SECONDS must be 0–9999999 seconds (0 disables the watchdog)')
    return int(value)


class PiIdleTimeout(TimeoutError):
    def __init__(self, seconds):
        self.seconds = seconds
        super().__init__(f'Pi produced no progress for {seconds:g} seconds. This request was stopped.')


@dataclass
class PiReply:
    text: str = ''
    failed: Optional[str] = None
    settled: bool = False
    stderr: bytes = b''


async def reap_pi(proc):
    """The caller gives Pi a dedicated process group. Also reap descendants on cancellation."""
    try: os.killpg(proc.pid, signal.SIGKILL)
    except ProcessLookupError: pass
    async def drain(stream):
        if stream is not None:
            while await stream.read(65536): pass
    await asyncio.gather(drain(proc.stdout), drain(proc.stderr), proc.wait())


async def collect_pi(proc, prompt, *, idle=None):
    """Consume stdout while writing stdin/draining stderr. Never deliver a thinking or text delta."""
    seconds = idle_seconds() if idle is None else idle

    async def progress(awaitable):
        try:
            return await asyncio.wait_for(awaitable, seconds or None)
        except asyncio.TimeoutError as exc:
            raise PiIdleTimeout(seconds) from exc

    async def write_prompt():
        try:
            proc.stdin.write(prompt.encode()); await proc.stdin.drain()
        except (BrokenPipeError, ConnectionResetError):
            pass  # Use the child's actual exit status/diagnostic.
        finally:
            proc.stdin.close()

    async def stderr_tail():
        tail = b''
        if proc.stderr is not None:
            while chunk := await proc.stderr.read(8192):
                tail = (tail + chunk)[-4000:]
        return tail

    writer = asyncio.create_task(write_prompt()); errors = asyncio.create_task(stderr_tail())
    result = PiReply()
    try:
        while line := await progress(proc.stdout.readline()):
            event = json.loads(line)
            if event.get('type') == 'message_end' and event.get('message', {}).get('role') == 'assistant':
                message = event['message']; content = message.get('content', [])
                if message.get('stopReason') in ('error', 'aborted'):
                    result.failed = message.get('errorMessage') or 'Model failed'
                elif not any(c.get('type') == 'toolCall' for c in content):
                    result.failed = None
                    text = '\n'.join(c['text'] for c in content if c.get('type') == 'text').strip()
                    if message.get('stopReason') == 'length':
                        text = (text + '\n\n[The model reached its output limit. Ask to continue.]').strip()
                    if text: result.text = text
            elif event.get('type') == 'agent_settled':
                result.settled = not event.get('aborted', False)
        await progress(writer); await progress(proc.wait()); result.stderr = await progress(errors)
        return result
    finally:
        for task in (writer, errors):
            if not task.done(): task.cancel()
        await asyncio.gather(writer, errors, return_exceptions=True)
