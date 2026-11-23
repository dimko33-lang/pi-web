"""Local GigaAM worker: mono 16 kHz s16le on stdin, one bounded JSON transcript on stdout."""
from array import array
import json
import os
from pathlib import Path
import sys

RATE = 16000
WINDOW = 24*RATE
STEP = RATE//25


def windows(stream):
    pending = array('h')
    while True:
        raw = stream.read(2*(WINDOW-len(pending)))
        if len(raw)%2: raise ValueError('Incomplete PCM sample')
        pending.frombytes(raw)
        if len(pending)<WINDOW:
            if pending: yield pending
            return
        # Prefer a quiet 40 ms boundary in the last 4 s; carry every sample forward.
        def power(pos): return sum(x*x for x in pending[pos:pos+STEP:4])
        cut = min(range(20*RATE,WINDOW,STEP), key=power)+STEP//2
        yield pending[:cut]; pending=pending[cut:]


def main():
    assets = Path(sys.prefix)/'nikita-gigaam-v3-q8-tc042'
    sys.path.insert(0,str(assets/'wrapper'))
    os.environ['TRANSCRIBE_LIBRARY']=str(assets/'native/libtranscribe.so')
    import transcribe_cpp as tc
    lines=[]; length=0
    with tc.Model(assets/'model.gguf',backend='cpu') as model, model.session(n_threads=min(2,len(os.sched_getaffinity(0)))) as session:
        for samples in windows(sys.stdin.buffer):
            if len(samples)<RATE//10 or max(samples)-min(samples)<4: continue
            text=session.run(array('f',(x/32768. for x in samples)),timestamps='none').text.strip()
            if text:
                length+=len(text)+1
                if length>120000: raise ValueError('Speech exceeds text context budget')
                lines.append(text)
    print(json.dumps({'text':' '.join(lines)},ensure_ascii=False))

if __name__=='__main__': main()
