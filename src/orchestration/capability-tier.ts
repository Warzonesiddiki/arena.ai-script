import { PHASE3_ROLES, PHASE6_ROLES, type AgentRole } from './types';

/**
 * Explicit capability tiers.
 *
 * Phase 6 raises the agent cap from 3 to 5. That increase is **opt-in**: every
 * consumer defaults to `phase3`, so an un-migrated call site keeps the stricter
 * Phase 3 limits and fails closed rather than silently gaining capability.
 */
export type CapabilityTier = 'phase3' | 'phase6';

export const DEFAULT_CAPABILITY_TIER: CapabilityTier = 'phase3';

export interface TierLimits {
  tier: CapabilityTier;
  maxConcurrentAgents: number;
  maxHandoffs: number;
  roles: readonly AgentRole[];
}

const LIMITS: Readonly<Record<CapabilityTier, TierLimits>> = Object.freeze({
  phase3: Object.freeze({ tier: 'phase3', maxConcurrentAgents: 3, maxHandoffs: 12, roles: PHASE3_ROLES }),
  phase6: Object.freeze({ tier: 'phase6', maxConcurrentAgents: 5, maxHandoffs: 20, roles: PHASE6_ROLES }),
});

export class CapabilityTierError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'CapabilityTierError';
  }
}

export function isCapabilityTier(value: unknown): value is CapabilityTier {
  return value === 'phase3' || value === 'phase6';
}

export function assertCapabilityTier(value: unknown): CapabilityTier {
  if (!isCapabilityTier(value)) throw new CapabilityTierError(`Unsupported capability tier "${String(value)}".`);
  return value;
}

export function tierLimits(tier: CapabilityTier = DEFAULT_CAPABILITY_TIER): TierLimits {
  return LIMITS[assertCapabilityTier(tier)];
}

/** True when `role` is permitted at `tier`. Phase 6 roles are rejected at Phase 3. */
export function isRoleAllowed(role: unknown, tier: CapabilityTier = DEFAULT_CAPABILITY_TIER): role is AgentRole {
  return typeof role === 'string' && (tierLimits(tier).roles as readonly string[]).includes(role);
}

export function assertRoleAllowed(role: unknown, tier: CapabilityTier = DEFAULT_CAPABILITY_TIER): AgentRole {
  if (!isRoleAllowed(role, tier)) {
    throw new CapabilityTierError(`Role "${String(role)}" is not permitted at capability tier "${tier}".`);
  }
  return role;
}
