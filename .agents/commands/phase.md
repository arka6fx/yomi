Load the implementation brief for Phase $ARGUMENTS of the Yomi build roadmap.

Steps:
1. Read `specs/00-overview.md` and find the Phase $ARGUMENTS entry in the phase table.
2. Based on the phase, read the relevant spec files:
   - Phase 0: specs/02-sidecar.md, specs/08-speech.md
   - Phase 1: specs/05-desktop.md, specs/04-memory.md
   - Phase 2: specs/02-sidecar.md, specs/03-harness.md
   - Phase 3: specs/06-backend.md, specs/07-database.md, specs/09-pricing.md
   - Phase 4: specs/05-desktop.md, specs/01-architecture.md
   - Phase 5: (landing page — no deep spec needed)
3. List the specific `src/` files to create or modify for this phase.
4. State the three key invariants NOT to break while implementing this phase.
5. Identify the first sub-task to start with.
