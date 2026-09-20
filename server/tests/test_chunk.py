from yomi.shared.chunk import ChunkOptions, chunk_markdown


def test_empty_input():
    assert chunk_markdown("") == []
    assert chunk_markdown("   \n\n ") == []


def test_short_stays_single():
    text = "One paragraph.\n\nSecond paragraph."
    chunks = chunk_markdown(text)
    assert len(chunks) == 1
    assert chunks[0] == text


def test_segments_over_target_chars_split():
    seg = "word " * 400  # 2000 chars, single paragraph > targetChars
    chunks = chunk_markdown(seg, ChunkOptions(target_chars=500, overlap=100))
    # worst case: tail overlap + 2 + full segment
    assert all(len(c) <= 500 + 100 + 2 for c in chunks)
    assert len(chunks) >= 3
    assert all(c.strip() for c in chunks)


def test_greedy_packing_respects_target():
    parts = [f"p{i} " + "word " * 100 for i in range(4)]  # each ~504 chars
    text = "\n\n".join(parts)
    chunks = chunk_markdown(text, ChunkOptions(target_chars=600, overlap=20))
    assert all(len(c) <= 600 + 20 + 2 for c in chunks)
    # all original text is present across chunks (allow the overlap tail repetitions)
    assert text.split("\n\n")[0].strip() in chunks[0]


def test_defaults_used():
    text = "a" * 3000
    chunks = chunk_markdown(text)
    assert all(len(c) <= 1800 + 220 + 2 for c in chunks)


def test_crlf_normalized():
    assert chunk_markdown("one\r\n\r\ntwo") == chunk_markdown("one\n\ntwo")