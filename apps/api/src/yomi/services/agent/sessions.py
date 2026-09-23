
# Simple in-memory fallback + DB logic mock
_sessions: dict[str, list[dict]] = {}

def load_history(user_id: str) -> list[dict]:
    # In a real impl, fetch from DB
    return _sessions.get(user_id, [])

def append_turn(user_id: str, role: str, content: str) -> None:
    history = _sessions.get(user_id, [])
    history.append({"role": role, "content": content})
    if len(history) > 60:
        history = history[-60:]
    _sessions[user_id] = history
