"""Energy-based voice-activity detection (packages/shared/src/vad.ts).

Upgrade path: replace EnergyVad.process_frame with a Silero VAD; VadResult stays.
Input frames are sequences of int16 PCM samples or normalized floats in [-1, 1].
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

Sample = int | float


@dataclass
class VadResult:
    has_speech: bool
    speech_end: bool
    energy_db: float


@dataclass
class VadOptions:
    sample_rate: int = 16000
    frame_size_ms: int = 30
    speech_threshold_db: float = -35.0
    silence_threshold_db: float = -45.0
    silence_hangover_ms: int = 300


class EnergyVad:
    def __init__(self, opts: VadOptions | None = None) -> None:
        o = opts or VadOptions()
        self._sample_rate = o.sample_rate
        self._speech_thresh = o.speech_threshold_db
        self._silence_thresh = o.silence_threshold_db
        self._hangover_samples = round((o.silence_hangover_ms * o.sample_rate) / 1000)
        self._in_speech = False
        self._silence_samples = 0

    def process_frame(self, samples: Sequence[Sample]) -> VadResult:
        # Int16 PCM is scaled to [-1, 1]; float frames are already normalised.
        n = len(samples)
        if n == 0:
            return VadResult(has_speech=False, speech_end=False, energy_db=-200.0)

        is_float = not any(abs(v) > 1 for v in samples)
        total = 0.0
        for raw in samples:
            v = raw if is_float else raw / 32768
            total += v * v
        rms = (total / n) ** 0.5
        energy_db = 20 * math.log10(rms + 1e-10)

        has_speech = False
        speech_end = False

        if energy_db >= self._speech_thresh:
            has_speech = True
            self._in_speech = True
            self._silence_samples = 0
        elif energy_db < self._silence_thresh:
            if self._in_speech:
                self._silence_samples += n
                if self._silence_samples >= self._hangover_samples:
                    speech_end = True
                    self._in_speech = False
                    self._silence_samples = 0

        return VadResult(has_speech=has_speech, speech_end=speech_end, energy_db=energy_db)

    def reset(self) -> None:
        self._in_speech = False
        self._silence_samples = 0


def detect_speech_end(pcm: Sequence[Sample], opts: VadOptions | None = None) -> int:
    """Returns the sample index where speech ends; len(pcm) if speech never ended."""
    o = opts or VadOptions()
    vad = EnergyVad(o)
    frame_size = round((o.frame_size_ms * o.sample_rate) / 1000)
    offset = 0
    while offset + frame_size <= len(pcm):
        frame = pcm[offset : offset + frame_size]
        if vad.process_frame(frame).speech_end:
            return offset + frame_size
        offset += frame_size
    return len(pcm)