# Spec 23 - Autonomous Capability Validation

## Mission

Continuously discover, test, validate, improve, and re-test Yomi desktop
automation capabilities with objective evidence. A capability never passes just
because an action returned `ok`.

Required flow:

```text
execute action -> validate outcome -> verify state change -> mark pass/fail
```

## Implemented Core

- `capability_registry.json` model via `CapabilityRegistry`.
- `CapabilityValidationGraph`-style runner via `runCapabilityValidation()`.
- No-false-pass enforcement: at least one objective, passing evidence item is
  required, and all objective evidence must pass.
- Capability coverage dashboard with coverage score, priority score, weakest
  capability queue, and Markdown rendering.
- Failure analysis generation with root cause, failed/passed evidence, recovery
  attempts, and suggested fixes.
- Successful strategy persistence for future reuse.
- Office capability definitions with independent file evidence validators.

## Evidence Types

- `filesystem`
- `ui_state`
- `screenshot`
- `audio_state`
- `process_state`
- `network_state`
- `human_required`

`human_required` alone can never pass a test. It can only block with a clear
reason.

## Coverage Dashboard

The dashboard ranks every capability by:

- verified success rate
- evidence confidence
- recency
- known failure count

Weakest capabilities are prioritized first for self-testing and repair.

Example capability scores:

```text
WhatsApp messaging 98%
Spotify control 99%
Premiere export 82%
Bluetooth pairing 70%
```

## Office Validation Rule

Office actions must prove success independently:

- expected file exists
- extension matches the target app
- file is non-empty
- file can be read or reopened
- visible Office window matches the expected file when UI validation is active

The Word smoke test on 2026-06-12 showed why this matters: Word presented a
modal "Keep this file?" flow and UI/COM calls could appear successful while the
expected temp file did not exist.

## Verification

```bash
bun test apps/sidecar/src/automation/capability-validation.test.ts apps/sidecar/src/automation/office-capabilities.test.ts apps/sidecar/src/automation/self-improvement.test.ts
bunx eslint src/automation/capability-validation.ts src/automation/capability-validation.test.ts src/automation/office-capabilities.ts src/automation/office-capabilities.test.ts src/automation/self-improvement.ts src/automation/self-improvement.test.ts
```
