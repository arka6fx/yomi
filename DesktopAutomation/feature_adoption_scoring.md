# Feature Adoption Scoring

Every discovered concept must be scored before implementation.

## Score Dimensions

Each dimension is scored from 1 to 5.

| Dimension | 1 | 3 | 5 |
|---|---|---|---|
| Usefulness | Niche | Helps common workflows | Unlocks major capability/reliability |
| Complexity | Very complex | Moderate | Simple |
| Maintenance Cost | High ongoing burden | Manageable | Low |
| Performance Impact | Slower/heavier | Neutral | Faster/lighter |
| Security Impact | Adds risk | Neutral | Reduces risk |
| Compatibility | Fragile/platform-limited | Some constraints | Broadly compatible |

## Decision Formula

```text
total = usefulness + complexity + maintenanceCost + performanceImpact + securityImpact + compatibility
```

Interpretation:

- 26-30: implement when aligned with current spec.
- 21-25: propose and schedule.
- 16-20: keep in backlog.
- 11-15: research only.
- 6-10: reject unless explicitly requested.

## Required Proposal Template

```json
{
  "concept": "ScrollItemPattern scrollIntoView",
  "source": "Microsoft UIA / FlaUI",
  "problem": "Offscreen elements fail click/type actions even when discoverable in UIA tree.",
  "proposal": "Add UIA helper method scrollIntoView(ref) and call before action when IsOffscreen=true.",
  "scores": {
    "usefulness": 5,
    "complexity": 4,
    "maintenanceCost": 5,
    "performanceImpact": 4,
    "securityImpact": 4,
    "compatibility": 4
  },
  "total": 26,
  "tests": [
    "unit: actionability planner calls scrollIntoView for offscreen element",
    "integration: UIA helper scrolls list item into view",
    "regression: click offscreen list item succeeds after scroll"
  ],
  "decision": "implement"
}
```

## Rejection Rules

- Do not implement if security impact is 1 unless user explicitly approves.
- Do not implement if compatibility is 1 and there is no fallback.
- Do not implement if no automated validation path exists.
- Do not implement hidden features that AGENTS.md marks as pending unless the spec is supplied.
