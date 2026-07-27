import type { AgentRole, TaskStatus } from '../orchestration/types';
import type { OrchestrationServiceSnapshot } from '../background/orchestration-service';

export interface OrchestrationDashboardElements {
  dashboard: HTMLElement | null;
  agentCost: HTMLElement | null;
}

export type ApproveHandler = (taskId: string) => void;

export function renderOrchestrationDashboard(
  documentRef: Document,
  elements: OrchestrationDashboardElements,
  orchestration: OrchestrationServiceSnapshot,
  onApprove: ApproveHandler,
): void {
  if (!elements.dashboard || !elements.agentCost) return;
  elements.agentCost.textContent = `$${orchestration.estimatedCostUsd.toFixed(2)}`;
  elements.dashboard.replaceChildren();

  if (!orchestration.active) {
    elements.dashboard.textContent = 'No active plan.';
    return;
  }

  orchestration.cards.forEach((card) => {
    const row = documentRef.createElement('div');
    row.className = 'aamp-agent-row';
    row.dataset.taskId = card.id;

    const summary = documentRef.createElement('span');
    const approvalText = card.approvalRequired
      ? card.canApprove ? 'approval required' : card.approvalBlockedReason ?? 'waiting for dependency approval'
      : 'approved';
    summary.textContent = `${card.role}: ${card.status} · ${approvalText}`;
    row.append(summary);

    if (card.approvalRequired) {
      const button = documentRef.createElement('button');
      button.type = 'button';
      button.className = 'aamp-button aamp-button-quiet';
      button.textContent = 'Approve';
      button.disabled = !card.canApprove;
      button.addEventListener('click', () => onApprove(card.id));
      row.append(' ', button);
    }

    elements.dashboard!.append(row);
  });
}

export interface OrchestrationResponse {
  ok: true;
  orchestration: OrchestrationServiceSnapshot;
}

export function isOrchestrationResponse(value: unknown): value is OrchestrationResponse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const response = value as { ok?: unknown; orchestration?: unknown };
  return response.ok === true && isOrchestrationSnapshot(response.orchestration);
}

function isOrchestrationSnapshot(value: unknown): value is OrchestrationServiceSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const snapshot = value as { active?: unknown; planId?: unknown; goal?: unknown; cards?: unknown; estimatedCostUsd?: unknown; safety?: unknown };
  return typeof snapshot.active === 'boolean'
    && (snapshot.planId === null || typeof snapshot.planId === 'string')
    && (snapshot.goal === null || typeof snapshot.goal === 'string')
    && Array.isArray(snapshot.cards)
    && snapshot.cards.every(isDashboardCard)
    && typeof snapshot.estimatedCostUsd === 'number'
    && Number.isFinite(snapshot.estimatedCostUsd)
    && snapshot.estimatedCostUsd >= 0
    && isSafetySnapshot(snapshot.safety);
}

function isDashboardCard(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const card = value as {
    id?: unknown;
    role?: unknown;
    title?: unknown;
    status?: unknown;
    dependsOn?: unknown;
    estimatedCostUsd?: unknown;
    progress?: unknown;
    approvalRequired?: unknown;
    canApprove?: unknown;
    approvalBlockedReason?: unknown;
  };
  return typeof card.id === 'string'
    && isRole(card.role)
    && typeof card.title === 'string'
    && isStatus(card.status)
    && Array.isArray(card.dependsOn)
    && card.dependsOn.every((dependency) => typeof dependency === 'string')
    && typeof card.estimatedCostUsd === 'number'
    && Number.isFinite(card.estimatedCostUsd)
    && card.estimatedCostUsd >= 0
    && typeof card.progress === 'number'
    && Number.isFinite(card.progress)
    && card.progress >= 0
    && card.progress <= 1
    && typeof card.approvalRequired === 'boolean'
    && typeof card.canApprove === 'boolean'
    && (card.approvalBlockedReason === null || typeof card.approvalBlockedReason === 'string');
}

function isSafetySnapshot(value: unknown): value is { activeAgents: number; handoffs: number } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const safety = value as { activeAgents?: unknown; handoffs?: unknown };
  const { activeAgents, handoffs } = safety;
  return Number.isSafeInteger(activeAgents)
    && Number.isSafeInteger(handoffs)
    && typeof activeAgents === 'number'
    && typeof handoffs === 'number'
    && activeAgents >= 0
    && activeAgents <= 3
    && handoffs >= 0
    && handoffs <= 12;
}

function isRole(value: unknown): value is AgentRole {
  return value === 'planner' || value === 'coder' || value === 'critic';
}

function isStatus(value: unknown): value is TaskStatus {
  return value === 'pending' || value === 'running' || value === 'completed' || value === 'failed' || value === 'blocked';
}
