import { PostTaskReflectionBuilder, PostTaskReflectionError } from '../../../src/reflection/post-task-reflection';
import type { OrchestrationServiceSnapshot } from '../../../src/background/orchestration-service';
import type { CausalTraceGraph } from '../../../src/debugging/causal-trace-debugger';

function orchestration(overrides: Partial<OrchestrationServiceSnapshot> = {}): OrchestrationServiceSnapshot {
  return {
    active: true,
    planId: 'plan-1',
    goal: 'Ship deterministic reflection',
    estimatedCostUsd: 0.4,
    safety: { activeAgents: 0, handoffs: 2 },
    cards: [
      {
        id: 'planner-1',
        role: 'planner',
        title: 'Plan reflection',
        status: 'completed',
        dependsOn: [],
        estimatedCostUsd: 0.05,
        progress: 1,
        approvalRequired: false,
        canApprove: false,
        approvalBlockedReason: null,
      },
      {
        id: 'coder-1',
        role: 'coder',
        title: 'Implement reflection',
        status: 'blocked',
        dependsOn: ['planner-1'],
        estimatedCostUsd: 0.25,
        progress: 1,
        approvalRequired: true,
        canApprove: false,
        approvalBlockedReason: 'Cost gate blocked coder.',
      },
      {
        id: 'critic-1',
        role: 'critic',
        title: 'Review reflection',
        status: 'pending',
        dependsOn: ['coder-1'],
        estimatedCostUsd: 0.1,
        progress: 0,
        approvalRequired: true,
        canApprove: false,
        approvalBlockedReason: 'Coder is blocked.',
      },
    ],
    ...overrides,
  };
}

function graph(): CausalTraceGraph {
  return {
    generatedAt: 1,
    truncated: false,
    nodes: [],
    edges: [],
    rootCauses: [
      { nodeId: 'task:coder-1', severity: 'blocked', summary: 'Blocked: coder cost gate via cost-gate' },
      { nodeId: 'trace:error-1', severity: 'error', summary: 'Error: test command failed' },
    ],
  };
}

describe('PostTaskReflectionBuilder', () => {
  it('builds a deterministic bounded report from orchestration and causal findings', () => {
    const report = new PostTaskReflectionBuilder().build({ orchestration: orchestration(), causalGraph: graph(), now: 2_000 });

    expect(report).toEqual(expect.objectContaining({
      schemaVersion: 1,
      generatedAt: 2_000,
      workflow: expect.objectContaining({ planId: 'plan-1', status: 'blocked', estimatedCostUsd: 0.4 }),
      modelReflection: { status: 'not-requested' },
    }));
    expect(report.tasks).toHaveLength(3);
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'finding:blocked:coder-1', severity: 'warning' }),
      expect.objectContaining({ id: 'finding:root-cause:trace:error-1', severity: 'critical' }),
    ]));
    expect(report.recommendations.map((recommendation) => recommendation.id)).toEqual(expect.arrayContaining([
      'recommendation:resolve-approvals',
      'recommendation:inspect-blockers',
      'recommendation:add-regression-test',
      'recommendation:memory-review',
    ]));
    expect(report.memoryCandidates[0]).toEqual(expect.objectContaining({ workflowId: 'plan-1', taskId: 'coder-1' }));
  });

  it('classifies completed and inactive workflows without model assistance', () => {
    const builder = new PostTaskReflectionBuilder();
    const completed = builder.build({
      orchestration: orchestration({
        cards: orchestration().cards.map((card) => ({ ...card, status: 'completed', approvalRequired: false, canApprove: false, approvalBlockedReason: null })),
      }),
      now: 1,
    });
    const inactive = builder.build({ orchestration: { active: false, planId: null, goal: null, cards: [], estimatedCostUsd: 0, safety: { activeAgents: 0, handoffs: 0 } }, now: 1 });

    expect(completed.workflow.status).toBe('completed');
    expect(completed.memoryCandidates).toEqual([expect.objectContaining({ kind: 'lesson', tags: ['reflection', 'completed'] })]);
    expect(inactive.workflow.status).toBe('not-started');
    expect(inactive.findings).toEqual([]);
  });

  it('keeps model-produced reflection approval-gated', () => {
    const builder = new PostTaskReflectionBuilder();
    const report = builder.build({ orchestration: orchestration(), now: 1 });

    expect(builder.markModelReflectionApprovalRequired(report).modelReflection).toEqual(expect.objectContaining({ status: 'approval-required' }));
    expect(() => builder.attachApprovedModelReflection(report, { approvedByHuman: false, content: 'model text', approvedAt: 2 } as never))
      .toThrow(PostTaskReflectionError);
    expect(() => builder.attachApprovedModelReflection(report, { approvedByHuman: true, content: '   ', approvedAt: 2 }))
      .toThrow(PostTaskReflectionError);

    const approved = builder.attachApprovedModelReflection(report, { approvedByHuman: true, content: ' Useful model-authored note.\n', approvedAt: 2 });
    expect(approved.modelReflection).toEqual({ status: 'approved', content: 'Useful model-authored note.', approvedAt: 2 });
  });

  it('turns memory candidates into explicit approved memory inputs only after approval', () => {
    const builder = new PostTaskReflectionBuilder();
    const report = builder.build({ orchestration: orchestration(), causalGraph: graph(), now: 1 });

    expect(() => builder.toMemoryInputs(report, false as never)).toThrow(PostTaskReflectionError);
    const memoryInputs = builder.toMemoryInputs(report, true);
    expect(memoryInputs[0]).toEqual(expect.objectContaining({
      id: expect.stringMatching(/^mem:reflection:plan-1:/u),
      source: { type: 'approved-reflection', approvedByHuman: true },
      scope: expect.objectContaining({ workflowId: 'plan-1' }),
    }));
  });
});
