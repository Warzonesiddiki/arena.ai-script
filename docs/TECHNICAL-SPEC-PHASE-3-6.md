# TECHNICAL SPECIFICATION
## Phase 3 & Phase 6 — Multi-Agent Orchestration Core

**Document Version**: 1.0  
**Last Updated**: 2026-07-27

---

## 1. OVERVIEW

This document provides the detailed technical specification for the **Multi-Agent Orchestration** system in Arena Agent Mode Pro.

- **Phase 3**: Light Multi-Agent (Maximum 3 agents)
- **Phase 6**: Full Multi-Agent Arena Mode (Up to 5 agents)

---

## 2. ARCHITECTURE PRINCIPLES

1. **Deterministic Orchestrator** — Written in TypeScript, not LLM-based.
2. **Scoped Context** — Agents receive minimal necessary context.
3. **Strict Contracts** — All agent communication uses validated JSON schemas.
4. **Observability First** — Every action emits structured telemetry.
5. **Safety by Default** — Circuit breakers, recursion limits, and approval gates.

---

## 3. PHASE 3 — LIGHT MULTI-AGENT (Max 3 Agents)

### 3.1 Roles

| Role | Responsibility | Max Context |
|------|----------------|-------------|
| **Planner** | Decomposes goal into tasks | Full goal |
| **Coder** | Writes and edits code | Relevant files only |
| **Critic** | Reviews output for issues | Previous agent's output |

### 3.2 Orchestrator (`background/orchestrator.ts`)

**Key Responsibilities**:
- Task decomposition
- Agent spawning via `chrome.tabs.create`
- Context scoping
- State management
- Safety enforcement

**Core Methods**:
```ts
createPlan(goal: string): Promise<AgentPlan>
spawnAgent(role: AgentRole, task: Task): Promise<AgentInstance>
routeWork(plan: AgentPlan): Promise<void>
collectResults(): Promise<AgentResults>
```

### 3.3 Context Scoping Engine

- Uses **snapshot + diff** model
- Agents never receive full conversation history
- Only receives scoped task + necessary files

### 3.4 Safety Mechanisms

- Hard recursion limit: **12 handoffs**
- Circuit breaker on repeated failures
- Early termination on cost threshold

---

## 4. PHASE 6 — FULL MULTI-AGENT ARENA MODE (Up to 5 Agents)

### 4.1 Expanded Roles

| Role | Responsibility |
|------|----------------|
| **Planner** | Task decomposition |
| **Researcher** | Information gathering |
| **Coder** | Code writing |
| **Critic** | Quality review |
| **Executor** | Command execution & testing |

### 4.2 Enhanced Orchestrator Features

- Dynamic routing based on task type
- Result comparison and scoring engine
- Per-workflow budget enforcement
- Full distributed tracing

### 4.3 Result Comparison UI

- Side-by-side view in Side Panel
- Automatic scoring (correctness, efficiency, style)
- One-click merge of best parts

---

## 5. MESSAGE PROTOCOLS

### Agent Handoff Schema

```json
{
  "type": "agent:handoff",
  "from": "planner",
  "to": "coder",
  "taskId": "task_123",
  "payload": {
    "goal": "...",
    "files": [...],
    "constraints": {...}
  },
  "timestamp": 1750000000000
}
```

### Result Schema

```json
{
  "type": "agent:result",
  "agentId": "coder_001",
  "taskId": "task_123",
  "status": "completed",
  "output": {...},
  "metrics": {
    "tokensUsed": 1240,
    "durationMs": 45000
  }
}
```

---

## 6. SAFETY & LIMITS

| Limit | Phase 3 | Phase 6 | Enforcement |
|-------|---------|---------|-------------|
| Max concurrent agents | 3 | 5 | Hard |
| Max handoffs per run | 12 | 20 | Hard |
| Max tokens per agent | 8,000 | 12,000 | Soft warning + hard stop |
| Max cost per workflow | $0.50 | $2.00 | User-configurable |

---

## 7. OBSERVABILITY

Every agent action must emit:

- `agent:spawned`
- `agent:taskStarted`
- `agent:handoff`
- `agent:result`
- `agent:error`
- `agent:terminated`

All events include `correlationId` for tracing.

---

**This technical specification is ready for implementation.**

Would you like me to also create:
- A **file structure diagram** for the entire extension?
- A **data flow diagram** for multi-agent execution?
- Implementation tickets broken down by subphase?