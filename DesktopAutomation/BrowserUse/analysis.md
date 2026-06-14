# Browser Use — Knowledge Extraction

## Architecture Overview
Browser Use is a Python library enabling LLM agents to control browsers. It extracts DOM state for LLM consumption, maps LLM decisions to browser actions, and maintains context across turns.

## Key Architectural Patterns

### 1. DOM State Extraction
The system parses browser DOM/accessibility trees into structured text for LLM consumption. Key decisions:
- Element indexing (clickable elements get numeric IDs)
- Content truncation with strategic summarization
- Accessibility vs raw DOM tree (prefers accessibility for cleaner representation)

**Yomi relevance**: Yomi's UIA tree serialization for LLM consumption could adopt similar strategies for element indexing and content truncation.

### 2. Action Schema from LLM Output
LLM decisions are mapped to structured browser actions:
- Click, input_text, select_option, scroll, navigate, extract_content
- Each action parameterized with element index and values
- Multi-step plans with sequential action lists

**Yomi relevance**: Yomi's already does this with its UIA action layer. Browser Use's schema is analogous to Yomi's `UiaAction` union type.

### 3. Error Recovery & Retry
- Stale element references trigger re-query
- Network failures trigger page reload
- LLM decision errors trigger re-prompt with error context

**Yomi relevance**: Yomi's recovery ladder (reResolve → reFocus → reScan → rePlan) is similar. The re-prompt-with-error pattern is worth adopting in Yomi's agent loop.

### 4. Screenshot + DOM Integration
- Screenshots used for visual grounding alongside DOM data
- Dual-input: LLM sees both accessibility tree and screenshot
- Element coordinates in screenshots mapped to DOM elements

**Yomi relevance**: Yomi's `vision-layer.ts` currently treats screenshots as a fallback. The dual-input approach (UIA tree + screenshot) could improve element grounding.

### 5. Self-Healing Selectors
- When a selector fails, alternative selectors are tried
- Selector prioritization: accessibility → CSS → XPath → text
- Position-based fallback when all selectors fail

**Yomi relevance**: Add to Yomi's selector strategy: AutomationId → Name+Role → ClassName → Position-based.

### 6. Agent Loop Architecture
- Turn-based: user input → LLM decision → action → observation → next LLM decision
- Context maintenance: full conversation log with truncation
- Goal tracking: current objective maintained across turns

**Yomi relevance**: Yomi's ReAct loop already follows this pattern. Browser Use's goal-tracking across turns could improve Yomi's task persistence.
