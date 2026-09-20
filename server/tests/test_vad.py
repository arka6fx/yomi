"""EnergyVad / detect_speech_end parity tests (packages/shared/src/vad.ts)."""

from yomi.shared.vad import EnergyVad, VadOptions, VadResult, detect_speech_end

SPEECH = 2000  # int16 sample -> ~-24 dB
SILENCE = 10  # int16 sample -> ~-70 dB
FRAME = 480  # 30ms @ 16kHz


def _frame_of(value: int, size: int = FRAME) -> list[int]:
    return [value] * size


def test_speech_frame_detects_speech() -> None:
    result = EnergyVad().process_frame(_frame_of(SPEECH))
    assert isinstance(result, VadResult)
    assert result.has_speech is True
    assert result.energy_db > -35


def test_silence_frame_no_speech() -> None:
    result = EnergyVad().process_frame(_frame_of(SILENCE))
    assert result.has_speech is False
    assert result.speech_end is False
    assert result.energy_db < -45


def test_empty_frame_is_silent() -> None:
    result = EnergyVad().process_frame([])
    assert result.has_speech is False
    assert result.speech_end is False
    assert result.energy_db == -200.0


def test_float_frames_treated_as_normalised() -> None:
    result = EnergyVad().process_frame([0.8, -0.8, 0.3, -0.3])
    assert result.has_speech is True
    assert result.energy_db > -35


def test_hangover_fires_speech_end_after_silence() -> None:
    vad = EnergyVad()  # hangover 300ms = 4800 samples
    assert vad.process_frame(_frame_of(SPEECH)).speech_end is False
    for _ in range(9):  # 9 x 480 = 4320 silence samples
        assert vad.process_frame(_frame_of(SILENCE)).speech_end is False
    tenth = vad.process_frame(_frame_of(SILENCE))
    assert tenth.speech_end is True
    assert tenth.has_speech is False


def test_reset_clears_hangover_state() -> None:
    vad = EnergyVad()
    vad.process_frame(_frame_of(SPEECH))
    vad.reset()
    assert vad.process_frame(_frame_of(SPEECH)).has_speech is True


def test_custom_hangover_options() -> None:
    vad = EnergyVad(VadOptions(silence_hangover_ms=60))  # 960 samples
    vad.process_frame(_frame_of(SPEECH))
    assert vad.process_frame(_frame_of(SILENCE, size=960)).speech_end is True


def test_detect_speech_end_silence_only_returns_length() -> None:
    pcm = _frame_of(SILENCE, size=FRAME * 5)
    assert detect_speech_end(pcm) == len(pcm)


def test_detect_speech_end_returns_after_hangover() -> None:
    pcm = _frame_of(SPEECH, size=FRAME) + _frame_of(SILENCE, size=FRAME * 11)
    end = detect_speech_end(pcm)
    assert 0 < end < len(pcm)
    assert end == FRAME * 11