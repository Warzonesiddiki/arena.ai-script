# Section 027: Auto-Save Prompts & History — Step 3: Product Brief

## Vision
Saves the current session snapshot (turns, tool calls, tokens, errors, messages, agent steps) to GM storage whenever the tab is about to unload, so SessionRecovery can offer to restore it next visit.

## Target User
Power users running Arena.ai Agent Mode sessions who want visibility into, and control over,
what the agent is doing without leaving the page.

## Value Proposition
Part of the broader Arena Agent Mode Pro toolset — this section contributes one focused
capability (`boot init() beforeunload/pagehide handlers`) to that toolset rather than standing alone as a separate product.
