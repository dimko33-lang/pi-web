"""Validate media at the two boundaries of the Telegram circle renderer."""
import argparse
import math
import wave
from pathlib import Path


def speech_pcm(path):
    with wave.open(str(path), 'rb') as wav:
        if (wav.getsampwidth(), wav.getnchannels(), wav.getframerate(), wav.getcomptype()) != (2, 1, 24000, 'NONE'):
            raise ValueError('Expected uncompressed 24 kHz mono s16le WAV')
        frames = wav.getnframes()
        if not 0 < frames <= 60 * 24000:
            raise ValueError('Speech exceeds circle duration or is empty')
        pcm = wav.readframes(frames)
        if len(pcm) != frames * 2:
            raise ValueError('Incomplete WAV payload')
        return pcm


def circle_duration(path):
    import av
    with av.open(str(path)) as media:
        if sorted(s.type for s in media.streams) != ['audio', 'video']:
            raise ValueError('Expected exactly one audio and one video track')
        video, audio = media.streams.video[0], media.streams.audio[0]
        if (video.codec_context.name, video.width, video.height, audio.codec_context.name) != ('h264', 640, 640, 'aac') or 'mp4' not in media.format.name.split(','):
            raise ValueError('Expected square H.264/AAC MP4')
        durations = [media.duration / av.time_base, *(float(s.duration * s.time_base) for s in media.streams)]
    if not all(math.isfinite(d) and 0 < d <= 60 for d in durations):
        raise ValueError('Invalid circle duration')
    return durations[0]


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('kind', choices=['wav', 'mp4'])
    parser.add_argument('path', type=Path)
    args = parser.parse_args()
    print(len(speech_pcm(args.path)) / 48000 if args.kind == 'wav' else circle_duration(args.path))
