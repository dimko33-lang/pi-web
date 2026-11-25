"""Diagnostic: python circle_render.py speech.wav new-circle.mp4 (Python 3.11+)."""
import asyncio
import os
import wave
import sys
import tempfile
import time
from fractions import Fraction
from pathlib import Path

from circle_media import circle_duration, speech_pcm


async def render(source, destination):
    import av
    import numpy as np
    from scipy.signal import resample_poly
    from circle_match import SpeechReceipt
    from anam import AnamClient, AnamEvent
    from anam.types import AgentAudioInputConfig, DirectorNotes, PersonaConfig

    pcm = speech_pcm(source)
    credential = Path(os.environ.get('CREDENTIALS_DIRECTORY', '/nonexistent')) / 'anam-key'
    key = credential.read_text().strip() if credential.is_file() else os.environ['ANAM_API_KEY']
    direction = DirectorNotes(
        expressivity=0.0,
        custom_style_prompt='Formal, cool reserve. Level gaze, still head and brows. Neutral lip corners; speak unsmiling with minimal articulation.',
    )
    client = AnamClient(api_key=key, persona_config=PersonaConfig(
        avatar_id=os.environ['ANAM_AVATAR_ID'], avatar_model='cara-4.1-express',
        director_notes=direction, enable_audio_passthrough=True,
    ))
    ready = asyncio.Event()

    @client.on(AnamEvent.SESSION_READY)
    async def session_ready():
        ready.set()

    # Match windows near both ends of the source against returned audio. Do not
    # use end_sequence or local wall-clock time as a playback acknowledgement.
    source16 = resample_poly(np.frombuffer(pcm, dtype='<i2').astype(float), 1, 3)
    receipt = SpeechReceipt(source16)
    counts = {'audio': 0, 'video': 0}
    complete = asyncio.Event()
    with tempfile.TemporaryDirectory(dir=destination.parent) as tmp:
        target = Path(tmp) / 'circle.mp4'
        from contextlib import ExitStack
        with ExitStack() as stack:
            debug_audio = None
            if os.environ.get('CIRCLE_CAPTURE_RETURN') == '1':
                raw = stack.enter_context(destination.with_suffix('.returned.wav').open('xb'))
                debug_audio = stack.enter_context(wave.open(raw, 'wb'))
                debug_audio.setparams((1, 2, 8000, 0, 'NONE', ''))
            mux = stack.enter_context(av.open(str(target), 'w'))
            video = mux.add_stream('libx264', rate=30)
            video.width = video.height = 640
            video.pix_fmt = 'yuv420p'
            video.options = {'preset':'veryfast', 'threads':'2'}
            audio = mux.add_stream('aac', rate=48000)
            audio.layout = 'mono'
            epoch = time.monotonic()

            async def capture(iterator, stream, rate, is_video):
                base = first = None
                monitor = av.AudioResampler(format='s16', layout='mono', rate=8000) if not is_video else None
                chunks, count, checked = [], 0, 0
                previous = -1
                async for frame in iterator:
                    counts['video' if is_video else 'audio'] += 1
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
                            if debug_audio is not None:
                                debug_audio.writeframes(piece.to_ndarray().astype('<i2').tobytes())
                            chunks.append(samples)
                            count += len(samples)
                        if count - checked >= 4000 and count >= receipt.end and not complete.is_set():
                            checked = count
                            if receipt.matches(np.concatenate(chunks)):
                                complete.set()
                    frame.pts, frame.time_base = pts, Fraction(1, rate)
                    mux.mux(stream.encode(frame))
                raise RuntimeError('Unexpected end of media')

            async with asyncio.timeout(85), client.connect() as session:
                async with asyncio.TaskGroup() as group:
                    tasks = [group.create_task(capture(session.video_frames(), video, 30, True)), group.create_task(capture(session.audio_frames(), audio, 48000, False))]
                    await ready.wait()
                    agent = session.create_agent_audio_input_stream(AgentAudioInputConfig(encoding='pcm_s16le', sample_rate=24000, channels=1))
                    # The engine buffers the sequence. Follow the SDK sample;
                    # sleeping for chunk duration can starve its playback buffer.
                    for i in range(0, len(pcm), 24000):
                        await agent.send_audio_chunk(pcm[i:i+24000])
                        await asyncio.sleep(.01)
                    await agent.end_sequence()
                    try:
                        await asyncio.wait_for(complete.wait(), len(pcm)/48000 + 15)
                    finally:
                        print('circle receipt: input_s=%.2f frames=%s edge_scores=%s complete=%s' % (len(pcm)/48000, counts, [round(v,2) for v in receipt.scores], complete.is_set()), file=sys.stderr, flush=True)
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
