"""Find returned speech at both ends; silence and RTP time alone are not receipts."""
import numpy as np
from scipy.signal import correlate

RATE = 8000


class SpeechReceipt:
    def __init__(self, source):
        self.length = len(source)
        voiced = np.flatnonzero(abs(source) > max(60, abs(source).max() * .025))
        if len(voiced) < 1000:
            raise ValueError('Insufficient voiced samples')
        self.start, self.end = int(voiced[0]), int(voiced[-1]) + 1
        self.size = min(1600, (self.end - self.start) // 3)
        # Opus may smear a breath or sibilant at the exact boundary. Test
        # overlapping alternatives near each edge, not just one waveform.
        span = min(2400, (self.end-self.start-2*self.size)//2)
        shifts = range(0, span + 1, 400)
        self.edges = [[(p, source[p:p+self.size]) for p in positions]
                      for positions in ([self.start+i for i in shifts], [self.end-self.size-i for i in shifts])]
        self.scores = [0., 0.]

    def matches(self, captured):
        if len(captured) < self.end: return False
        y = np.asarray(captured, dtype=float)
        power = np.r_[0., np.cumsum(y*y)]
        norm = np.sqrt(np.maximum(1., power[self.size:] - power[:-self.size]))
        found = [[], []]
        for side, anchors in enumerate(self.edges):
            for p, w in anchors:
                energy = w @ w
                if energy < self.size * 60**2: continue
                # Require a causally plausible match. A vowel elsewhere in the
                # utterance must not displace an actual endpoint candidate.
                lo, hi = max(0, p-800), min(len(norm), p+12*RATE)
                if hi <= lo: continue
                s = correlate(y[lo:hi+self.size-1], w, mode='valid', method='fft')/(norm[lo:hi]*np.sqrt(energy))
                i = int(s.argmax()); score = float(s[i]); self.scores[side] = max(self.scores[side], score)
                if score >= .55: found[side].append(i+lo-p)
        return any(-1600 <= b-a <= 32000 and len(y) >= b+self.length+2000 for a in found[0] for b in found[1])
