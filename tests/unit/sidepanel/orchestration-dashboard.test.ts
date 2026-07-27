import { isOrchestrationResponse, renderOrchestrationDashboard } from '../../../src/sidepanel/orchestration-dashboard';
import type { OrchestrationServiceSnapshot } from '../../../src/background/orchestration-service';

function snapshot(): OrchestrationServiceSnapshot {
  return {
    active: true,
    planId: 'plan-1',
    goal: 'Goal',
    estimatedCostUsd: 0.4,
    safety: { activeAgents: 0, handoffs: 0 },
    cards: [
      {
        id: 'planner-1',
        role: 'planner',
        title: 'Plan',
        status: 'pending',
        dependsOn: [],
        estimatedCostUsd: 0.05,
        progress: 0,
        approvalRequired: true,
        canApprove: true,
        approvalBlockedReason: null,
      },
      {
        id: 'coder-1',
        role: 'coder',
        title: 'Code',
        status: 'pending',
        dependsOn: ['planner-1'],
        estimatedCostUsd: 0.25,
        progress: 0,
        approvalRequired: true,
        canApprove: false,
        approvalBlockedReason: 'Task "coder-1" requires dependency "planner-1" to be approved before approval.',
      },
    ],
  };
}

describe('sidepanel orchestration dashboard rendering', () => {
  it('renders text-only rows and approves by explicit task id', () => {
    document.body.innerHTML = '<span id="cost"></span><div id="dashboard"></div>';
    const approve = jest.fn();

    renderOrchestrationDashboard(
      document,
      { dashboard: document.getElementById('dashboard'), agentCost: document.getElementById('cost') },
      snapshot(),
      approve,
    );

    expect(document.getElementById('cost')?.textContent).toBe('$0.40');
    expect(document.querySelectorAll('.aamp-agent-row')).toHaveLength(2);
    expect(document.querySelector('[data-task-id="planner-1"]')?.textContent).toContain('planner: pending · approval required');
    expect((document.querySelector('[data-task-id="coder-1"] button') as HTMLButtonElement | null)?.disabled).toBe(true);

    (document.querySelector('[data-task-id="planner-1"] button') as HTMLButtonElement).click();
    expect(approve).toHaveBeenCalledWith('planner-1');
  });

  it('renders the inactive state without approval controls', () => {
    document.body.innerHTML = '<span id="cost"></span><div id="dashboard"></div>';

    renderOrchestrationDashboard(
      document,
      { dashboard: document.getElementById('dashboard'), agentCost: document.getElementById('cost') },
      { active: false, planId: null, goal: null, cards: [], estimatedCostUsd: 0, safety: { activeAgents: 0, handoffs: 0 } },
      jest.fn(),
    );

    expect(document.getElementById('dashboard')?.textContent).toBe('No active plan.');
    expect(document.querySelector('button')).toBeNull();
  });

  it('validates bounded orchestration responses before rendering', () => {
    expect(isOrchestrationResponse({ ok: true, orchestration: snapshot() })).toBe(true);
    expect(isOrchestrationResponse({ ok: true, orchestration: { ...snapshot(), safety: { activeAgents: 4, handoffs: 0 } } })).toBe(false);
    expect(isOrchestrationResponse({ ok: true, orchestration: { ...snapshot(), cards: [{ ...snapshot().cards[0], role: 'executor' }] } })).toBe(false);
    expect(isOrchestrationResponse({ ok: true, orchestration: { ...snapshot(), extra: '<b>ignored</b>' } })).toBe(true);
  });
});
