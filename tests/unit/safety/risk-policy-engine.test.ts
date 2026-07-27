import { defaultRules, RiskPolicyEngine, RiskPolicyError, type ProposedAction, type PolicyRule } from '../../../src/safety/risk-policy-engine';

function action(overrides: Partial<ProposedAction> = {}): ProposedAction {
  return {
    id: 'act-1',
    kind: 'memory-write',
    role: 'coder',
    taskId: 'coder-1',
    summary: 'Store an approved summary',
    ...overrides,
  };
}

const engine = new RiskPolicyEngine();

describe('RiskPolicyEngine', () => {
  it('never auto-approves, even for the lowest-risk action', () => {
    const decision = engine.evaluate(action());

    expect(decision.autoApproved).toBe(false);
    expect(decision.verdict).toBe('allow');
    // "allow" still only means it may reach the normal approval gate.
    expect(engine.gate(action()).reason).toContain('standard approval gate still applies');
  });

  it('requires approval for every inherently dangerous action kind', () => {
    for (const kind of ['network-egress', 'file-write', 'tool-execution', 'page-mutation'] as const) {
      const decision = engine.evaluate(action({ kind }));
      expect({ kind, verdict: decision.verdict }).toEqual({ kind, verdict: 'require-approval' });
      expect(engine.gate(action({ kind })).permitted).toBe(false);
      expect(engine.gate(action({ kind }), { approvedByHuman: true }).permitted).toBe(true);
    }
  });

  it('denies out-of-scope actions outright and approval cannot override a denial', () => {
    const decision = engine.evaluate(action({ kind: 'tool-execution', outOfScope: true }));

    expect(decision.verdict).toBe('deny');
    expect(decision.decidingRuleId).toBe('deny-out-of-scope');
    // Even with human approval, a denial stands.
    expect(engine.gate(action({ kind: 'tool-execution', outOfScope: true }), { approvedByHuman: true }).permitted).toBe(false);
  });

  it('applies the most restrictive verdict when several rules match', () => {
    const decision = engine.evaluate(action({ kind: 'file-write', irreversible: true, estimatedCostUsd: 2 }));

    expect(decision.findings.map((finding) => finding.ruleId)).toEqual([
      'no-unreviewed-file-write', 'irreversible-requires-justification', 'expensive-action-approval',
    ]);
    // require-approval outranks require-justification.
    expect(decision.verdict).toBe('require-approval');
    expect(decision.riskLevel).toBe('critical');
    expect(decision.riskScore).toBe(4);
  });

  it('requires a recorded justification for irreversible and moderately costly work', () => {
    const irreversible = action({ kind: 'memory-write', irreversible: true });
    expect(engine.evaluate(irreversible).verdict).toBe('require-justification');
    expect(engine.gate(irreversible).permitted).toBe(false);
    expect(engine.gate(irreversible, { justification: '   ' }).permitted).toBe(false);
    expect(engine.gate(irreversible, { justification: 'Needed to unblock the plan.' }).permitted).toBe(true);

    expect(engine.evaluate(action({ estimatedCostUsd: 0.5 })).verdict).toBe('require-justification');
    expect(engine.evaluate(action({ estimatedCostUsd: 0.25 })).verdict).toBe('allow');
    expect(engine.evaluate(action({ estimatedCostUsd: 1.01 })).verdict).toBe('require-approval');
  });

  it('never scores risk below the inherent floor for the action kind', () => {
    // No rule matches a plain model invocation, but it is still medium risk.
    const decision = engine.evaluate(action({ kind: 'model-invocation' }));
    expect(decision.findings).toEqual([]);
    expect(decision.riskLevel).toBe('medium');
    expect(decision.explanation).toContain('No policy rule matched');

    expect(engine.evaluate(action({ kind: 'memory-write' })).riskLevel).toBe('low');
    expect(engine.evaluate(action({ kind: 'plan-approval' })).riskLevel).toBe('low');
  });

  it('evaluates rules in a deterministic order', () => {
    const decision = engine.evaluate(action({ kind: 'network-egress', irreversible: true }));
    expect(decision.findings.map((finding) => finding.ruleId)).toEqual([
      'no-unreviewed-egress', 'irreversible-requires-justification',
    ]);
    // Repeated evaluation is identical.
    expect(engine.evaluate(action({ kind: 'network-egress', irreversible: true }))).toEqual(decision);
  });

  it('fails closed when a custom rule predicate throws', () => {
    const throwing = new RiskPolicyEngine([{
      id: 'broken',
      description: 'A rule with a faulty predicate',
      matches: () => { throw new Error('boom'); },
      verdict: 'allow',
      riskLevel: 'none',
      rationale: 'n/a',
    }]);

    const decision = throwing.evaluate(action());
    expect(decision.verdict).toBe('deny');
    expect(decision.findings[0]?.rationale).toContain('failing closed');
  });

  it('supports custom rules and exposes them without the predicate', () => {
    const custom: PolicyRule = {
      id: 'no-critic-writes',
      description: 'The critic role may not write memory',
      order: 5,
      matches: (candidate) => candidate.role === 'critic' && candidate.kind === 'memory-write',
      verdict: 'deny',
      riskLevel: 'high',
      rationale: 'Reviewers should not mutate shared memory.',
    };
    const custom_engine = new RiskPolicyEngine([...defaultRules(), custom]);

    expect(custom_engine.evaluate(action({ role: 'critic' })).verdict).toBe('deny');
    expect(custom_engine.evaluate(action({ role: 'coder' })).verdict).toBe('allow');
    const listed = custom_engine.listRules().find((rule) => rule.id === 'no-critic-writes');
    expect(listed).toBeDefined();
    expect(listed).not.toHaveProperty('matches');
    // The custom rule's low order number puts it first.
    expect(custom_engine.listRules()[0]?.id).toBe('no-critic-writes');
  });

  it('rejects malformed rules and actions', () => {
    expect(() => new RiskPolicyEngine('nope' as never)).toThrow(RiskPolicyError);
    expect(() => new RiskPolicyEngine([{ ...defaultRules()[0]!, id: '../bad' }])).toThrow(RiskPolicyError);
    expect(() => new RiskPolicyEngine([defaultRules()[0]!, defaultRules()[0]!])).toThrow(RiskPolicyError);
    expect(() => new RiskPolicyEngine([{ ...defaultRules()[0]!, matches: undefined as never }])).toThrow(RiskPolicyError);
    expect(() => new RiskPolicyEngine([{ ...defaultRules()[0]!, verdict: 'maybe' as never }])).toThrow(RiskPolicyError);
    expect(() => new RiskPolicyEngine([{ ...defaultRules()[0]!, riskLevel: 'spicy' as never }])).toThrow(RiskPolicyError);
    expect(() => new RiskPolicyEngine(Array.from({ length: 51 }, (_unused, index) => ({ ...defaultRules()[0]!, id: `r-${index}` })))).toThrow(RiskPolicyError);

    expect(() => engine.evaluate(null as never)).toThrow(RiskPolicyError);
    expect(() => engine.evaluate(action({ id: '../bad' }))).toThrow(RiskPolicyError);
    expect(() => engine.evaluate(action({ kind: 'launch-missiles' as never }))).toThrow(RiskPolicyError);
    expect(() => engine.evaluate(action({ summary: '  ' }))).toThrow(RiskPolicyError);
    expect(() => engine.evaluate(action({ estimatedCostUsd: -1 }))).toThrow(RiskPolicyError);
  });
});
