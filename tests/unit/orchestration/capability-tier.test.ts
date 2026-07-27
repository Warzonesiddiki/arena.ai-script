import {
  assertCapabilityTier,
  assertRoleAllowed,
  CapabilityTierError,
  DEFAULT_CAPABILITY_TIER,
  isCapabilityTier,
  isRoleAllowed,
  tierLimits,
} from '../../../src/orchestration/capability-tier';
import { OrchestrationSafetyGuard, SafetyViolation } from '../../../src/orchestration/safety-guard';

describe('capability tiers', () => {
  it('defaults to the stricter phase3 tier so capability is opt-in', () => {
    expect(DEFAULT_CAPABILITY_TIER).toBe('phase3');
    expect(tierLimits()).toEqual(expect.objectContaining({ tier: 'phase3', maxConcurrentAgents: 3, maxHandoffs: 12 }));
    expect(tierLimits().roles).toEqual(['planner', 'coder', 'critic']);
  });

  it('raises limits and roles only at the phase6 tier', () => {
    expect(tierLimits('phase6')).toEqual(expect.objectContaining({ maxConcurrentAgents: 5, maxHandoffs: 20 }));
    expect(tierLimits('phase6').roles).toEqual(['planner', 'researcher', 'coder', 'executor', 'critic']);
  });

  it('rejects phase6 roles while the phase3 tier is active', () => {
    expect(isRoleAllowed('coder', 'phase3')).toBe(true);
    expect(isRoleAllowed('researcher', 'phase3')).toBe(false);
    expect(isRoleAllowed('executor', 'phase3')).toBe(false);
    expect(isRoleAllowed('researcher', 'phase6')).toBe(true);
    expect(isRoleAllowed('overlord', 'phase6')).toBe(false);
    expect(isRoleAllowed(42, 'phase6')).toBe(false);

    expect(assertRoleAllowed('executor', 'phase6')).toBe('executor');
    expect(() => assertRoleAllowed('executor', 'phase3')).toThrow(CapabilityTierError);
  });

  it('validates tier identifiers and fails closed on unknown tiers', () => {
    expect(isCapabilityTier('phase6')).toBe(true);
    expect(isCapabilityTier('phase9')).toBe(false);
    expect(assertCapabilityTier('phase3')).toBe('phase3');
    expect(() => assertCapabilityTier('phase9')).toThrow(CapabilityTierError);
    expect(() => tierLimits('phase9' as never)).toThrow(CapabilityTierError);
  });
});

describe('OrchestrationSafetyGuard tier enforcement', () => {
  it('enforces the phase3 cap of three concurrent agents by default', () => {
    const guard = new OrchestrationSafetyGuard();
    guard.startAgent('a');
    guard.startAgent('b');
    guard.startAgent('c');
    expect(guard.availableAgentSlots()).toBe(0);
    expect(() => guard.startAgent('d')).toThrow(SafetyViolation);
  });

  it('permits five concurrent agents and twenty handoffs at phase6', () => {
    const guard = new OrchestrationSafetyGuard({ tier: 'phase6' });
    for (const id of ['a', 'b', 'c', 'd', 'e']) guard.startAgent(id);
    expect(guard.snapshot().activeAgents).toBe(5);
    expect(() => guard.startAgent('f')).toThrow(SafetyViolation);

    for (let index = 0; index < 20; index += 1) guard.handoff();
    expect(() => guard.handoff()).toThrow(SafetyViolation);
  });

  it('allows overrides to tighten limits but never to widen beyond the tier', () => {
    const tightened = new OrchestrationSafetyGuard({ tier: 'phase6', maxAgents: 2 });
    tightened.startAgent('a');
    tightened.startAgent('b');
    expect(() => tightened.startAgent('c')).toThrow(SafetyViolation);

    // A phase3 guard cannot be talked into phase6 capacity.
    expect(() => new OrchestrationSafetyGuard({ tier: 'phase3', maxAgents: 5 })).toThrow(SafetyViolation);
    expect(() => new OrchestrationSafetyGuard({ tier: 'phase6', maxHandoffs: 100 })).toThrow(SafetyViolation);
    expect(() => new OrchestrationSafetyGuard({ maxAgents: 0 })).toThrow(SafetyViolation);
  });

  it('keeps the legacy positional constructor working', () => {
    const guard = new OrchestrationSafetyGuard(2, 1);
    expect(guard.limits()).toEqual({ maxAgents: 1, maxHandoffs: 2 });
    guard.startAgent('a');
    expect(() => guard.startAgent('b')).toThrow(SafetyViolation);
  });

  it('frees a slot when an agent stops and still requires approval', () => {
    const guard = new OrchestrationSafetyGuard({ tier: 'phase6' });
    guard.startAgent('a');
    guard.startAgent('a');
    expect(guard.snapshot().activeAgents).toBe(1);
    guard.stopAgent('a');
    expect(guard.availableAgentSlots()).toBe(5);
    expect(() => guard.requireApproval('task-1')).toThrow(SafetyViolation);
    guard.approve('task-1');
    expect(() => guard.requireApproval('task-1')).not.toThrow();
  });
});
