"""Diagnostic: python circle_render.py speech.wav new-circle.mp4 (Python 3.11+)."""
import asyncio
import os
import sys
import tempfile
import time
from fractions import Fraction
from pathlib import Path

from circle_media import circle_duration, speech_pcm


async def render(source, destination):
    import av
    import numpy as np
    from scipy.signal import correlate
    from anam import AnamClient, AnamEvent
    from anam.types import AgentAudioInputConfig, PersonaConfig

    pcm = speech_pcm(source)
    credential = Path(os.environ.get('CREDENTIALS_DIRECTORY', '/nonexistent')) / 'anam-key'
    key = credential.read_text().strip() if credential.is_file() else os.environ['ANAM_API_KEY']
    client = AnamClient(api_key=key, persona_config=PersonaConfig(avatar_id=os.environ['ANAM_AVATAR_ID'], avatar_model='cara-4.1-express', enable_audio_passthrough=True))
    ready = asyncio.Event()

    @client.on(AnamEvent.SESSION_READY)
    async def session_ready():
        ready.set()

    # Match windows near both ends of the source against returned audio. Do not
    # use end_sequence or local wall-clock time as a playback acknowledgement.
    source16 = np.frombuffer(pcm, dtype='<i2')[::3].astype(np.float32)
    voiced = np.flatnonzero(abs(source16) > max(60, abs(source16).max() * .025))
    if len(voiced) < 1000:
        raise ValueError('Insufficient voiced samples')
    start, end = int(voiced[0]), int(voiced[-1]) + 1
    size = min(6000, (end - start) // 2)
    windows = [(p, source16[p:p+size]) for p in (start, end-size)]
    complete = asyncio.Event()
    with tempfile.TemporaryDirectory(dir=destination.parent) as tmp:
        target = Path(tmp) / 'circle.mp4'
        with av.open(str(target), 'w') as mux:
            video = mux.add_stream('libx264', rate=30)
            video.width = video.height = 640
            video.pix_fmt = 'yuv420p'
            audio = mux.add_stream('aac', rate=48000)
            audio.layout = 'mono'
            epoch = time.monotonic()

            async def capture(iterator, stream, rate, is_video):
                base = first = None
                monitor = av.AudioResampler(format='s16', layout='mono', rate=8000) if not is_video else None
                chunks, count, checked = [], 0, 0
                previous = -1
                async for frame in iterator:
                    if first is None:
                        base, first = time.monotonic() - epoch, frame.time
                    pts = round((base + frame.time - first) * rate)
                    if is_video:
                        if pts <= previous:
                            continue
                        previous = pts
                        rgb = frame.to_ndarray(format='rgb24')
                        h, w = rgb.shape[:2]
                        n = min(w, h)
                        y, x = (h-n)//2, (w-n)//2
                        frame = av.VideoFrame.from_ndarray(np.ascontiguousarray(rgb[y:y+n,x:x+n]), format='rgb24').reformat(width=640, height=640, format='yuv420p')
                    else:
                        for piece in monitor.resample(frame):
                            samples = piece.to_ndarray().flatten().astype(np.float32)
                            chunks.append(samples)
                            count += len(samples)
                        if count - checked >= 4000 and count >= end and not complete.is_set():
                            checked = count
                            captured = np.concatenate(chunks)
                            energy = np.r_[0., np.cumsum(captured.astype(float)**2)]
                            offsets = []
                            for p, window in windows:
                                scores = correlate(captured, window, mode='valid', method='fft') / np.sqrt(np.maximum(1., (energy[size:] - energy[:-size]) * np.dot(window, window)))
                                i = int(np.argmax(scores))
                                if scores[i] >= .55:
                                    offsets.append(i-p)
                            if len(offsets) == 2 and abs(offsets[0]-offsets[1]) < 1000 and count >= offsets[1]+len(source16)+2000:
                                complete.set()
                    frame.pts, frame.time_base = pts, Fraction(1, rate)
                    mux.mux(stream.encode(frame))
                raise RuntimeError('Unexpected end of media')

            async with asyncio.timeout(85), client.connect() as session:
                async with asyncio.TaskGroup() as group:
                    tasks = [group.create_task(capture(session.video_frames(), video, 30, True)), group.create_task(capture(session.audio_frames(), audio, 48000, False))]
                    await ready.wait()
                    agent = session.create_agent_audio_input_stream(AgentAudioInputConfig(encoding='pcm_s16le', sample_rate=24000, channels=1))
                    for i in range(0, len(pcm), 9600):
                        await agent.send_audio_chunk(pcm[i:i+9600])
                        await asyncio.sleep(.2)
                    await agent.end_sequence()
                    await complete.wait()
                    await asyncio.sleep(.3)
                    for task in tasks:
                        task.cancel()
            for stream in (audio, video):
                mux.mux(stream.encode(None))
        duration = circle_duration(target)
        os.link(target, destination)  # Never replace an existing diagnostic artifact.
        return duration


if __name__ == '__main__':
    print(asyncio.run(render(*map(Path, sys.argv[1:]))))
