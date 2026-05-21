---
description: Write and run tests for a feature (invokes yomi-test-writer + yomi-test-runner)
---
Write and run tests for the feature specified in $ARGUMENTS.

If no argument is provided, stop and say:
"Please provide a spec name. Usage: /test-feature <name> e.g. /test-feature sidecar-fast-pipeline"

If the spec file at `specs/$ARGUMENTS.md` does not exist, stop and say: "Spec file not found at specs/$ARGUMENTS.md."

---

## Step 1: Write Tests

Invoke **yomi-test-writer** with:
- Spec file: `specs/$ARGUMENTS.md`
- Source files to read for structure: relevant files in `apps/` based on the spec
- Output test file: place next to source files with `.test.ts` suffix (Bun convention)
- Instruction: Write tests based on what the spec says the feature SHOULD do. Cover happy paths, edge cases, auth guards, validation errors, and state changes.

Wait for yomi-test-writer to fully complete before proceeding to Step 2.

---

## Step 2: Run Tests

Invoke **yomi-test-runner** with:
- The test file(s) created in Step 1
- Spec file: `specs/$ARGUMENTS.md`
- Run command: `bun test <path-to-test-file>`
- Instruction: Run ONLY the specified test file. Analyze failures by cross-referencing the test code, the spec, and source files.

---

## Handoff Rules

- Do NOT start Step 2 until Step 1 is fully complete
- Do NOT attempt to fix any code regardless of test results
- Do NOT run tests beyond the ones created in Step 1
- If yomi-test-writer could not write the test file, stop and report the reason

---

## Final Output

```
Testing Pipeline Report — $ARGUMENTS

Step 1 — Tests Written
[List each test with a one-line description of which spec requirement it validates]

Step 2 — Test Results
[from yomi-test-runner's structured report]

Verdict
✅ Ready for code review — all tests pass
❌ Needs fixes — list failing tests and root causes
```
