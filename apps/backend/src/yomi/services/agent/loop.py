import json
import logging
from typing import Any

import openai
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.conf import settings
from yomi.services.agent.tools import build_user_registry, registry
from yomi.services.metering import ChargeInput, charge_usage

logger = logging.getLogger(__name__)


async def _charge_composio_usage(
    db_session: AsyncSession, active: Any, user_id: str, plan: str
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
        await charge_usage(
            db_session,
            ChargeInput(user=user, kind="composio_tool", units=count),  # type: ignore[arg-type]
        )
    except Exception as e:
        logger.warning("failed to charge composio usage for %s: %s", user_id, e)


async def run_agent_loop(
    messages: list[dict],
    user_id: str,
    plan: str,
    max_steps: int | None = None,
    db_session: AsyncSession | None = None,
    create_pending_action=None,
) -> str:
    max_steps = max_steps or settings.agent_max_steps
    client = openai.AsyncOpenAI(api_key=settings.openai_api_key)

    model = settings.openai_agent_model if plan == "max" else settings.openai_fast_model
    if db_session is not None:
        active = await build_user_registry(db_session, user_id, create_pending_action)
        tools = active.get_openai_tools()
    else:
        active = registry
        tools = registry.get_openai_tools()

    async def _run() -> str:
        nonlocal messages
        if len(messages) > 50:
            compression_prompt = [{"role": "system", "content": "Compress this conversation history concisely."}] + messages
            res = await client.chat.completions.create(
                model=settings.openai_fast_model,
                messages=compression_prompt,
            )
            compressed = res.choices[0].message.content or ""
            messages = [{"role": "system", "content": f"Previous context: {compressed}"}] + messages[-10:]

        for step in range(max_steps):
            is_last_step = step == max_steps - 1

            req_kwargs = {
                "model": model,
                "messages": messages,
            }
            if tools and not is_last_step:
                req_kwargs["tools"] = tools

            res = await client.chat.completions.create(**req_kwargs)
            msg = res.choices[0].message

            messages.append(msg.model_dump(exclude_none=True))

            if not msg.tool_calls:
                return msg.content or ""

            for tool_call in msg.tool_calls:
                tool_name = tool_call.function.name
                try:
                    args = json.loads(tool_call.function.arguments)
                    result = await active.execute(tool_name, **args)
                    result_str = str(result)
                except Exception as e:
                    result_str = f"Error: {e}"

                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": result_str,
                })

        return "Reached maximum steps without finishing."

    messages = list(messages)
    result = await _run()
    if db_session is not None:
        await _charge_composio_usage(db_session, active, user_id, plan)
    return result