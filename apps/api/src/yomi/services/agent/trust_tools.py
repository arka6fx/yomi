"""Agent tools for Trusted people (D1 only).

Messages to another person's Yomi are external communication, so they queue
for the user's approval like any other send; approval delivers them.
"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from typing import Any

from yomi.connectors.base import SEND
from yomi.services import trust_d1
from yomi.services.cloudflare_storage.deps import D1Backend


def register_trust_tools(
    tool_registry: Any,
    backend: D1Backend,
    user_id: str,
    create_pending_action: Callable[[dict], Awaitable[dict]] | None,
) -> None:
    async def trusted_people_list() -> str:
        return json.dumps({"people": await trust_d1.trusted_people(backend, user_id)})

    async def trusted_inbox() -> str:
        return json.dumps({"messages": await trust_d1.inbox(backend, user_id)})

    async def message_trusted_person(
        person_id: str, message: str, reply_to: str | None = None
    ) -> str:
        people = {p["id"]: p["name"] for p in await trust_d1.trusted_people(backend, user_id)}
        if person_id not in people:
            return json.dumps({"error": "That person isn't in your trusted people."})
        if create_pending_action is None:
            return json.dumps({"error": "messages need an approval surface"})
        pending = await create_pending_action({
            "connector": "trust",
            "action": "trust-sendMessage",
            "risk": SEND,
            "title": f"Message {people[person_id]}'s Yomi",
            "preview": message[: trust_d1.MAX_MESSAGE_CHARS],
            "confirm_text": "Send",
            "payload": {"recipient_id": person_id, "body": message, "reply_to": reply_to},
        })
        return json.dumps(pending)

    tool_registry.register(
        name="trusted_people_list",
        description="List the user's trusted people, whose Yomi agents you can message.",
        parameters={"type": "object", "properties": {}},
        func=trusted_people_list,
    )
    tool_registry.register(
        name="trusted_inbox",
        description=(
            "Read recent messages that trusted people's Yomi agents sent to this user. "
            "Use it when the user replies to or asks about such a message."
        ),
        parameters={"type": "object", "properties": {}},
        func=trusted_inbox,
    )
    tool_registry.register(
        name="message_trusted_person",
        description=(
            "Send a message to a trusted person's Yomi (it reaches them on Telegram). "
            "Write it on the user's behalf, e.g. to coordinate a time. The user approves "
            "before it's sent. Pass reply_to with the inbox message id when answering."
        ),
        parameters={
            "type": "object",
            "properties": {
                "person_id": {"type": "string"},
                "message": {"type": "string"},
                "reply_to": {"type": "string"},
            },
            "required": ["person_id", "message"],
        },
        func=message_trusted_person,
    )
