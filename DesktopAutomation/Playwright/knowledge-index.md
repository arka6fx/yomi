# Playwright — Knowledge Index

## Source Metadata
- **Source**: https://github.com/microsoft/playwright
- **Type**: Library (not cloned — >3GB repo, docs suffice)
- **Docs**: https://playwright.dev/docs/intro
- **Language**: TypeScript (cross-browser via CDP/WebDriver BiDi)
- **Last Updated**: 2026-06-12

## Architecture Patterns for Yomi to Adopt

### Auto-Waiting (Most Important Pattern)
Playwright's auto-wait mechanism is the gold standard for reliability:
- **Actionability checks**: Every click/fill waits for element to be attached, visible, stable, enabled, and not obscured
- **No manual sleep()**: Eliminates flaky timing-dependent tests
- **Strict mode**: Throws if multiple elements match selector (prevents "wrong element" bugs)
- **Retry with timeout**: Each action retries until element meets actionability or timeout

**Yomi adoption**: The `waitForElement` RPC method should be upgraded to check:
1. Element attached to DOM/UIA tree
2. Element visible (not offscreen, not zero-size)
3. Element enabled (not disabled/grayed out)
4. Element stable (position not animating)
5. Element not obscured (no overlay on top)

### Selector Strategy
```
text=Submit           > getByRole('button', { name: 'Submit' }) [best]
css=.btn-primary      > getByTestId('submit-btn')
xpath=//button        > locator('button')
```

**Yomi adoption**: Element resolution priority:
1. AutomationId (most stable)
2. Name + ControlType (role)
3. ClassName (fragile, last resort)
4. Position-based (absolute last resort)

### Network Interception
- `page.route()`: Mock, block, or modify network requests
- `page.waitForResponse()`: Wait for specific API calls to complete
- **Use case for Yomi**: Detect when app is "done loading" by watching API responses

### Dialog Handling
- Auto-dismiss alerts/confirms/prompts unless explicitly handled
- `page.on('dialog')`: Catch unexpected dialogs
- **Yomi adoption**: Subscribe to WindowOpenedEvent to detect unexpected dialogs during automation

### Screenshot & Video
- Full page, element, or viewport screenshots
- Video recording of entire session
- **Yomi has this** via `captureScreen`, `captureRegion`, `windowScreenshot`

### Browser Context Isolation
- Separate browser contexts = separate sessions (cookies, storage, cache)
- **Yomi adoption**: Consider context-per-task isolation for multi-tab browser automation

### Tracing & Debugging
- `trace viewer`: Timeline of every action with screenshots, network, console, DOM snapshots
- **Yomi adoption**: The `AutomationRun` system (SQLite timeline) is Yomi's equivalent — but could add visual timeline for debugging

### Yomi Implementation Opportunities
1. **Actionability pipeline**: Pre-click checks (visible, enabled, not obscured, stable position)
2. **Selector priority engine**: Auto-select best selector strategy based on element properties
3. **Before/after screenshot**: Capture element screenshot before + after action for validation
4. **Network-aware waits**: Wait for API responses to confirm action completed (browser layer)
5. **Session recording**: Visual timeline with screenshots at each step (beyond JSON logs)
6. **Browser context reuse**: Maintain browser contexts across tasks for session persistence
