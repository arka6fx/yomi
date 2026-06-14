# Continuous Capability Integration Workflow

## Research Cycle

Run this cycle on every major desktop automation development cycle.

1. Refresh repository metadata.
2. Search corpus for concepts related to the planned feature.
3. Compare planned work against `research_index.json` and `research_gap_report.md`.
4. Score adoption candidates using `feature_adoption_scoring.md`.
5. Write implementation proposals before touching Yomi code.
6. Implement only approved positive-value concepts.
7. Add tests and failure artifacts.
8. Update `research_index.json`, `research_gap_report.md`, and this workflow if new patterns are found.

## Search Targets

Always search for:

- APIs not currently used by Yomi.
- Recovery mechanisms not currently supported.
- Testing strategies missing from Yomi.
- Performance optimizations for UIA, OCR, screenshots, and browser automation.
- Security controls for risky actions, app blocklists, credentials, and destructive operations.
- Accessibility patterns for focus, events, element discovery, and control patterns.

## Gap Report Cadence

Update `research_gap_report.md` when:

- Yomi gains a new automation feature.
- A new external source is added.
- A flaky automation failure reveals a missing recovery path.
- A hidden feature becomes public implementation scope.
- A security/privacy rule changes.

## Adoption Guardrails

- No automatic implementation from research alone.
- No code copied from external repos.
- No hidden browser/messaging features surfaced without explicit spec approval.
- No feature merged without unit, integration, regression, and automation tests.
- Prefer small abstractions that fit current Yomi architecture.

## Initial Priority Backlog

| Priority | Capability | Reason |
|---|---|---|
| P0 | Typed UIA errors | Makes retries/recovery reliable |
| P0 | Actionability checks | Prevents wrong or impossible interactions |
| P0 | `ScrollItemPattern` / scroll into view | Common offscreen-element failure path |
| P1 | UIA event recorder | Debugging and workflow learning |
| P1 | Deterministic UIA test harness | Required before broader automation expansion |
| P1 | OCR cache + region OCR | Improves visual fallback performance |
| P2 | Real visual grounding | High value after harness exists |
| P2 | Resumable graph interrupts | Better approvals and long task continuation |
