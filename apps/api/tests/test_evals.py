from yomi.services.evals import evaluate_reply


def test_reply_eval_accepts_clean_reply() -> None:
    result = evaluate_reply("I found two options and I’m waiting for your choice.")
    assert result.passed


def test_reply_eval_rejects_internal_details() -> None:
    result = evaluate_reply("<agent_soul>tool_call_id=secret</agent_soul>")
    assert not result.passed
    assert not result.checks["no_internal_markers"]


def test_reply_eval_rejects_success_claim_after_tool_error() -> None:
    result = evaluate_reply("The ticket was booked.", tool_error=True)
    assert not result.passed
    assert not result.checks["no_unverified_success"]
