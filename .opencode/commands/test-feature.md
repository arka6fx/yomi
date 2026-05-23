---
description: Write and run bun tests for a feature — /test-feature sidecar-fast-pipeline
---

Write and run tests for the feature in `$ARGUMENTS`.

If `$ARGUMENTS` is empty, stop: "Usage: /test-feature <spec-slug> — e.g. /test-feature sidecar-fast-pipeline"

If `specs/$ARGUMENTS.md` does not exist, stop: "Spec file not found at specs/$ARGUMENTS.md."

## Step 1 — Write tests

Invoke **yomi-test-writer** with:
- Spec file: `specs/$ARGUMENTS.md`
- Source files: relevant files in `apps/` based on the spec
- Output: `*.test.ts` next to each source file being tested
- Instruction: write tests based on what the spec says the feature SHOULD do — happy paths, edge cases, auth guards, validation errors, state changes

Wait for yomi-test-writer to fully complete before Step 2.

## Step 2 — Run tests

Invoke **yomi-test-runner** with:
- The test file(s) from Step 1
- Command: `bun test <path-to-test-file>`
- Instruction: run only the specified files; analyze failures by cross-referencing test code, spec, and source

## Rules

- Do NOT start Step 2 until Step 1 is complete
- Do NOT fix any source code regardless of test results
- Do NOT run tests beyond the ones created in Step 1

## Output

```
Testing Pipeline — $ARGUMENTS

Step 1 — Tests written
[each test with one-line description of which spec requirement it validates]

Step 2 — Results
[from yomi-test-runner structured report]

Verdict
✅ All tests pass
❌ <N> failures — list with root causes
```
