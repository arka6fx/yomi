import base64
import json
import logging
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from yomi.conf import settings
from yomi.services.agent.tools import build_user_registry, registry
from yomi.services.llm import chat_completion, first_message, model_for
from yomi.services.metering import ChargeInput, charge_usage

logger = logging.getLogger(__name__)


def format_tool_result(tool_call_id: str, result: Any) -> dict[str, Any]:
    """Build the tool reply message. Dict results carrying ``images`` (raw PNG
    bytes) become multi-part content so vision models can see screenshots."""
    if isinstance(result, dict) and isinstance(result.get("images"), list):
        parts: list[dict[str, Any]] = [
            {"type": "text", "text": str(result.get("text") or "")}
        ]
        for shot in result["images"]:
            if isinstance(shot, (bytes, bytearray)) and shot:
                parts.append({
                    "type": "image_url",
                    "image_url": {
                        "url": "data:image/png;base64,"
                        + base64.b64encode(bytes(shot)).decode()
                    },
                })
        return {"role": "tool", "tool_call_id": tool_call_id, "content": parts}
    text = result if isinstance(result, str) else str(result)
    return {"role": "tool", "tool_call_id": tool_call_id, "content": text}


async def _charge_composio_usage(
    db_session: AsyncSession, active: Any, user_id: str, plan: str,
    d1: Any = None,
) -> None:
    """Meter Composio tool calls (kind=composio_tool, 1 credit per execution)."""
    counter = getattr(active, "composio_calls", None)
    if counter is None:
        return
    count = counter()
    if count <= 0:
        return
    try:
        user = {"id": user_id, "plan": plan, "subscription_status": "active"}
        charge = ChargeInput(user=user, kind="composio_tool", units=count)  # type: ignore[arg-type]
        if d1 is not None:
            from yomi.services import billing_d1 as _billing_d1

            await _billing_d1.charge_usage(d1, charge)
        else:
            await charge_usage(db_session, charge)
    except Exception as e:
        logger.warning("failed to charge composio usage for %s: %s", user_id, e)


async def run_agent_loop(
    messages: list[dict],
    user_id: str,
    plan: str,
    max_steps: int | None = None,
    db_session: AsyncSession | None = None,
    create_pending_action=None,
    d1: Any = None,
) -> str:
    max_steps = max_steps or settings.agent_max_steps
    purpose = "agent" if plan == "max" else "fast"
    model = model_for(purpose)
    # d1 alone suffices for the user registry (tokens resolve via gateway);
    # db_session=None simply means "no Postgres", not "no user tools".
    if db_session is not None or d1 is not None:
        active = await build_user_registry(db_session, user_id, create_pending_action, d1)
        tools = active.get_openai_tools()
    else:
        active = registry
        tools = registry.get_openai_tools()

    async def _run() -> str:
        nonlocal messages
        if len(messages) > 50:
            compression_prompt = [{"role": "system", "content": "Compress this conversation history concisely."}] + messages
            compressed_data = await chat_completion("fast", compression_prompt)
            compressed = first_message(compressed_data).get("content") or ""
            messages = [{"role": "system", "content": f"Previous context: {compressed}"}] + messages[-10:]

        for step in range(max_steps):
            is_last_step = step == max_steps - 1

            data = await chat_completion(
                purpose, messages, tools=tools if tools and not is_last_step else None,
                model=model,
            )
            msg = first_message(data)

            # Keep only the chat fields; provider extras (reasoning traces,
            # logprobs, routing metadata) must not re-enter context.
            clean = {"role": msg.get("role") or "assistant"}
            if msg.get("content") is not None:
                clean["content"] = msg.get("content")
            if msg.get("tool_calls") is not None:
                clean["tool_calls"] = msg.get("tool_calls")
            messages.append(clean)

            tool_calls = msg.get("tool_calls") or []
            if not tool_calls:
                content = msg.get("content")
                return content if isinstance(content, str) else ""

            for tool_call in tool_calls:
                function = tool_call.get("function") or {}
                tool_name = function.get("name", "")
                try:
                    args = json.loads(function.get("arguments") or "{}")
                    result = await active.execute(tool_name, **args)
                    messages.append(format_tool_result(tool_call.get("id", ""), result))
                except Exception as e:
                    messages.append(format_tool_result(tool_call.get("id", ""), f"Error: {e}"))

        return "Reached maximum steps without finishing."

    messages = list(messages)
    result = await _run()
    if db_session is not None or d1 is not None:
        await _charge_composio_usage(db_session, active, user_id, plan, d1)
    return result