import type { CostDecision, CostProjection, CostUsage } from '../governance/cost-governance';
import type { TraceEvent, TraceLevel } from '../observability/tracer';
import type { OrchestrationServiceSnapshot } from '../background/orchestration-service';

const MAX_TRACE_EVENTS = 500;
const MAX_COST_EVENTS = 200;
const MAX_NODES = 1_000;
const MAX_EDGES = 2_000;
const MAX_EXPLANATION_STEPS = 25;
const MAX_ATTRIBUTE_KEYS = 20;

export type CausalNodeType = 'workflow' | 'task' | 'trace' | 'cost';
export type CausalEdgeReason = 'contains' | 'depends-on' | 'parent-span' | 'correlation-sequence' | 'task-event' | 'cost-event' | 'cost-gate';
export type CausalSeverity = TraceLevel | 'ok' | 'blocked';

export type CausalCostEvent =
  | { name: 'cost:projection'; payload: CostProjection; timestamp?: number; correlationId?: string }
  | { name: 'cost:reserved'; payload: CostDecision; timestamp?: number; correlationId?: string }
  | { name: 'cost:blocked'; payload: CostDecision; timestamp?: number; correlationId?: string }
  | { name: 'cost:recorded'; payload: CostUsage; timestamp?: number; correlationId?: string };

export interface CausalTraceDebuggerInput {
  traceEvents?: readonly TraceEvent[];
  orchestration?: OrchestrationServiceSnapshot | null;
  costEvents?: readonly CausalCostEvent[];
  now?: number;
  maxTraceEvents?: number;
  maxCostEvents?: number;
}

export interface CausalTraceNode {
  id: string;
  type: CausalNodeType;
  label: string;
  timestamp: number | null;
  correlationId: string | null;
  severity: CausalSeverity;
  attributes: Readonly<Record<string, string | number | boolean | null>>;
}

export interface CausalTraceEdge {
  from: string;
  to: string;
  reason: CausalEdgeReason;
  label: string;
}

export interface CausalRootCause {
  nodeId: string;
  severity: CausalSeverity;
  summary: string;
}

export interface CausalExplanationStep {
  node: CausalTraceNode;
  incomingReason: CausalEdgeReason | null;
  incomingLabel: string | null;
}

export interface CausalTraceGraph {
  generatedAt: number;
  nodes: readonly CausalTraceNode[];
  edges: readonly CausalTraceEdge[];
  rootCauses: readonly CausalRootCause[];
  truncated: boolean;
}

/**
 * Phase 4B deterministic causal debugger.
 *
 * It converts existing bounded trace events, orchestration state, and cost events
 * into a display-ready graph. It never invokes a model and never stores prompt,
 * DOM, file, or conversation content in graph attributes.
 */
export class CausalTraceDebugger {
  public build(input: CausalTraceDebuggerInput): CausalTraceGraph {
    const generatedAt = input.now ?? Date.now();
    const maxTraceEvents = boundedLimit(input.maxTraceEvents ?? MAX_TRACE_EVENTS, MAX_TRACE_EVENTS, 'maxTraceEvents');
    const maxCostEvents = boundedLimit(input.maxCostEvents ?? MAX_COST_EVENTS, MAX_COST_EVENTS, 'maxCostEvents');
    const nodes = new Map<string, CausalTraceNode>();
    const edges: CausalTraceEdge[] = [];
    let truncated = false;

    const addNode = (node: CausalTraceNode): void => {
      if (nodes.has(node.id)) return;
      if (nodes.size >= MAX_NODES) {
        truncated = true;
        return;
      }
      nodes.set(node.id, node);
    };
    const addEdge = (edge: CausalTraceEdge): void => {
      if (!nodes.has(edge.from) || !nodes.has(edge.to)) return;
      if (edges.some((existing) => existing.from === edge.from && existing.to === edge.to && existing.reason === edge.reason)) return;
      if (edges.length >= MAX_EDGES) {
        truncated = true;
        return;
      }
      edges.push(edge);
    };

    const taskNodeIdsByRole = new Map<string, string>();
    const workflowNodeId = input.orchestration?.active ? `workflow:${input.orchestration.planId ?? 'active'}` : null;
    if (input.orchestration?.active && workflowNodeId) {
      addNode({
        id: workflowNodeId,
        type: 'workflow',
        label: `Workflow: ${input.orchestration.goal ?? 'Untitled workflow'}`.slice(0, 180),
        timestamp: null,
        correlationId: null,
        severity: 'ok',
        attributes: sanitizeAttributes({
          planId: input.orchestration.planId,
          estimatedCostUsd: input.orchestration.estimatedCostUsd,
          activeAgents: input.orchestration.safety.activeAgents,
          handoffs: input.orchestration.safety.handoffs,
        }),
      });
      for (const card of input.orchestration.cards) {
        const taskNodeId = `task:${card.id}`;
        taskNodeIdsByRole.set(card.role, taskNodeId);
        addNode({
          id: taskNodeId,
          type: 'task',
          label: `${card.role}: ${card.title}`.slice(0, 180),
          timestamp: null,
          correlationId: null,
          severity: card.status === 'failed' ? 'error' : card.status === 'blocked' ? 'blocked' : 'ok',
          attributes: sanitizeAttributes({
            taskId: card.id,
            role: card.role,
            status: card.status,
            progress: card.progress,
            approvalRequired: card.approvalRequired,
            estimatedCostUsd: card.estimatedCostUsd,
          }),
        });
        addEdge({ from: workflowNodeId, to: taskNodeId, reason: 'contains', label: 'workflow contains task' });
      }
      for (const card of input.orchestration.cards) {
        for (const dependencyId of card.dependsOn) {
          addEdge({ from: `task:${dependencyId}`, to: `task:${card.id}`, reason: 'depends-on', label: 'task dependency' });
        }
      }
    }

    const traceEvents = [...(input.traceEvents ?? [])]
      .sort((left, right) => left.timestamp - right.timestamp || left.id.localeCompare(right.id))
      .slice(-maxTraceEvents);
    truncated ||= (input.traceEvents?.length ?? 0) > traceEvents.length;

    for (const event of traceEvents) {
      const nodeId = traceNodeId(event.id);
      addNode({
        id: nodeId,
        type: 'trace',
        label: event.name.slice(0, 180),
        timestamp: event.timestamp,
        correlationId: event.correlationId,
        severity: event.level,
        attributes: sanitizeAttributes({ ...event.attributes, traceId: event.id, parentId: event.parentId }),
      });
      if (event.parentId) addEdge({ from: traceNodeId(event.parentId), to: nodeId, reason: 'parent-span', label: 'span parent' });
      const taskId = stringAttribute(event.attributes, 'taskId');
      if (taskId) addEdge({ from: `task:${taskId}`, to: nodeId, reason: 'task-event', label: 'task trace event' });
      const role = stringAttribute(event.attributes, 'role');
      if (!taskId && role && taskNodeIdsByRole.has(role)) {
        addEdge({ from: taskNodeIdsByRole.get(role)!, to: nodeId, reason: 'task-event', label: 'role trace event' });
      }
    }

    for (const events of groupByCorrelation(traceEvents).values()) {
      for (let index = 1; index < events.length; index += 1) {
        addEdge({
          from: traceNodeId(events[index - 1]!.id),
          to: traceNodeId(events[index]!.id),
          reason: 'correlation-sequence',
          label: 'same correlation sequence',
        });
      }
    }

    const costEvents = [...(input.costEvents ?? [])].slice(-maxCostEvents);
    truncated ||= (input.costEvents?.length ?? 0) > costEvents.length;
    costEvents.forEach((event, index) => {
      const workflowId = 'workflowId' in event.payload ? event.payload.workflowId : 'unknown';
      const agentId = 'agentId' in event.payload ? event.payload.agentId : 'unknown';
      const nodeId = `cost:${event.name}:${workflowId}:${agentId}:${index}`;
      const severity = event.name === 'cost:blocked' || ('allowed' in event.payload && event.payload.allowed === false) ? 'blocked' : 'ok';
      addNode({
        id: nodeId,
        type: 'cost',
        label: `${event.name} · ${agentId}`,
        timestamp: event.timestamp ?? null,
        correlationId: event.correlationId ?? null,
        severity,
        attributes: sanitizeAttributes(costAttributes(event.payload)),
      });
      if (workflowNodeId) addEdge({ from: workflowNodeId, to: nodeId, reason: 'cost-event', label: 'workflow cost event' });
      const taskNodeId = taskNodeIdsByRole.get(agentId) ?? taskNodeIdsByRole.get(agentId.replace(/-1$/u, ''));
      if (taskNodeId) addEdge({ from: nodeId, to: taskNodeId, reason: 'cost-gate', label: 'cost gate affects task' });
    });

    const orderedNodes = [...nodes.values()].sort(compareNodes);
    const orderedEdges = edges.sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to) || left.reason.localeCompare(right.reason));
    return {
      generatedAt,
      nodes: orderedNodes,
      edges: orderedEdges,
      rootCauses: detectRootCauses(orderedNodes, orderedEdges),
      truncated,
    };
  }

  public explain(graph: CausalTraceGraph, nodeId: string): CausalExplanationStep[] {
    const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
    const target = nodes.get(nodeId);
    if (!target) throw new CausalTraceDebuggerError(`Unknown causal node "${nodeId}".`);

    const incoming = new Map<string, CausalTraceEdge[]>();
    for (const edge of graph.edges) incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge]);
    const reversed: Array<{ node: CausalTraceNode; edgeFromParent: CausalTraceEdge | null }> = [];
    const visited = new Set<string>();
    let current: CausalTraceNode | undefined = target;

    while (current && !visited.has(current.id) && reversed.length < MAX_EXPLANATION_STEPS) {
      visited.add(current.id);
      const parentEdge = chooseIncomingEdge(incoming.get(current.id) ?? []);
      reversed.push({ node: current, edgeFromParent: parentEdge });
      if (!parentEdge) break;
      current = nodes.get(parentEdge.from);
    }

    return reversed.reverse().map((step, index) => ({
      node: step.node,
      incomingReason: index === 0 ? null : step.edgeFromParent?.reason ?? null,
      incomingLabel: index === 0 ? null : step.edgeFromParent?.label ?? null,
    }));
  }
}

export class CausalTraceDebuggerError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'CausalTraceDebuggerError';
  }
}

function traceNodeId(traceId: string): string {
  return `trace:${traceId}`;
}

function groupByCorrelation(events: readonly TraceEvent[]): Map<string, TraceEvent[]> {
  const grouped = new Map<string, TraceEvent[]>();
  for (const event of events) grouped.set(event.correlationId, [...(grouped.get(event.correlationId) ?? []), event]);
  return grouped;
}

function costAttributes(payload: CostProjection | CostDecision | CostUsage): Record<string, unknown> {
  const attributes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key.endsWith('Usd') || key.endsWith('Budget') || ['workflowId', 'agentId', 'reservationId', 'allowed', 'reason', 'workflowOverBudget', 'agentOverBudget'].includes(key)) {
      attributes[key] = value;
    }
  }
  return attributes;
}

function detectRootCauses(nodes: readonly CausalTraceNode[], edges: readonly CausalTraceEdge[]): CausalRootCause[] {
  const incomingByNode = new Map<string, CausalTraceEdge[]>();
  for (const edge of edges) incomingByNode.set(edge.to, [...(incomingByNode.get(edge.to) ?? []), edge]);
  return nodes
    .filter((node) => node.severity === 'error' || node.severity === 'warn' || node.severity === 'blocked')
    .map((node) => ({
      nodeId: node.id,
      severity: node.severity,
      summary: rootCauseSummary(node, incomingByNode.get(node.id) ?? []),
    }))
    .sort((left, right) => severityRank(right.severity) - severityRank(left.severity) || left.nodeId.localeCompare(right.nodeId))
    .slice(0, 10);
}

function rootCauseSummary(node: CausalTraceNode, incoming: readonly CausalTraceEdge[]): string {
  const prefix = node.severity === 'blocked' ? 'Blocked' : node.severity === 'error' ? 'Error' : 'Warning';
  const via = incoming.length > 0 ? ` via ${incoming.map((edge) => edge.reason).join(', ')}` : '';
  return `${prefix}: ${node.label}${via}`.slice(0, 240);
}

function chooseIncomingEdge(edges: readonly CausalTraceEdge[]): CausalTraceEdge | null {
  const priority: CausalEdgeReason[] = ['parent-span', 'correlation-sequence', 'task-event', 'cost-gate', 'depends-on', 'contains', 'cost-event'];
  return [...edges].sort((left, right) => priority.indexOf(left.reason) - priority.indexOf(right.reason) || left.from.localeCompare(right.from))[0] ?? null;
}

function compareNodes(left: CausalTraceNode, right: CausalTraceNode): number {
  const leftTime = left.timestamp ?? Number.MAX_SAFE_INTEGER;
  const rightTime = right.timestamp ?? Number.MAX_SAFE_INTEGER;
  return leftTime - rightTime || typeRank(left.type) - typeRank(right.type) || left.id.localeCompare(right.id);
}

function typeRank(type: CausalNodeType): number {
  return type === 'workflow' ? 0 : type === 'task' ? 1 : type === 'cost' ? 2 : 3;
}

function severityRank(severity: CausalSeverity): number {
  return severity === 'error' ? 4 : severity === 'blocked' ? 3 : severity === 'warn' ? 2 : severity === 'info' ? 1 : 0;
}

function sanitizeAttributes(attributes: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const sanitized: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(attributes).slice(0, MAX_ATTRIBUTE_KEYS)) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(key)) continue;
    if (isSensitiveKey(key)) continue;
    if (value === null || typeof value === 'boolean') sanitized[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) sanitized[key] = value;
    else if (typeof value === 'string') sanitized[key] = value.slice(0, 300);
  }
  return sanitized;
}

function isSensitiveKey(key: string): boolean {
  return /prompt|conversation|message|secret|token|api.?key|raw|content|html|dom/iu.test(key);
}

function stringAttribute(attributes: Readonly<Record<string, string | number | boolean | null>>, key: string): string | null {
  const value = attributes[key];
  return typeof value === 'string' ? value : null;
}

function boundedLimit(value: number, defaultMax: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new CausalTraceDebuggerError(`${name} must be a positive safe integer.`);
  return Math.min(value, defaultMax);
}
