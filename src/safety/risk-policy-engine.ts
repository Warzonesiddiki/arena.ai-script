import type { AgentRole } from '../orchestration/types';

const MAX_RULES = 50;
const MAX_TEXT_CHARS = 300;

/**
 * Phase 11 safety policy engine and risk scoring.
 *
 * A deterministic, rule-based classifier for *proposed* actions. It is a
 * pre-flight check that runs before anything reaches an approval gate, and it
 * can only ever make the system **more** restrictive:
 *
 * - it never approves anything — the strongest verdict it returns is
 *   `allow`, which still means "may proceed to the normal human approval gate";
 * - it never executes, cancels, or retries work;
 * - it has no model in the loop, so its verdicts are reproducible and auditable.
 *
 * Rules are evaluated in a fixed order and the **most restrictive verdict wins**,
 * so adding a rule can never accidentally loosen policy.
 */

export type RiskLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';
export type PolicyVerdict = 'allow' | 'require-approval' | 'require-justification' | 'deny';

export type ActionKind =
  | 'model-invocation'
  | 'tool-execution'
  | 'file-write'
  | 'network-egress'
  | 'page-mutation'
  | 'schedule-create'
  | 'memory-write'
  | 'plan-approval'
  | 'cost-authorization';

/** Verdict severity. A higher value is more restrictive and always wins. */
const VERDICT_RANK: Readonly<Record<PolicyVerdict, number>> = Object.freeze({
  allow: 0,
  'require-justification': 1,
  'require-approval': 2,
  deny: 3,
});

const RISK_RANK: Readonly<Record<RiskLevel, number>> = Object.freeze({
  none: 0, low: 1, medium: 2, high: 3, critical: 4,
});

/**
 * Inherent risk floor per action kind.
 *
 * These are floors, not ceilings: a rule may raise an action's risk but never
 * lower it below its inherent level.
 */
const INHERENT_RISK: Readonly<Record<ActionKind, RiskLevel>> = Object.freeze({
  'model-invocation': 'medium',
  'tool-execution': 'high',
  'file-write': 'critical',
  'network-egress': 'critical',
  'page-mutation': 'high',
  'schedule-create': 'medium',
  'memory-write': 'low',
  'plan-approval': 'low',
  'cost-authorization': 'medium',
});

export interface ProposedAction {
  id: string;
  kind: ActionKind;
  role: AgentRole;
  taskId: string | null;
  summary: string;
  /** Estimated spend, when the action costs money. */
  estimatedCostUsd?: number;
  /** True when the action's effects cannot be undone. */
  irreversible?: boolean;
  /** True when the action would touch data outside the explicitly scoped context. */
  outOfScope?: boolean;
  /** Free-form tags a rule may match on. */
  tags?: readonly string[];
}

export interface PolicyRule {
  id: string;
  description: string;
  /** Lower numbers evaluate first. Ties break by rule ID. */
  order?: number;
  matches: (action: ProposedAction) => boolean;
  verdict: PolicyVerdict;
  riskLevel: RiskLevel;
  rationale: string;
}

export interface PolicyFinding {
  ruleId: string;
  verdict: PolicyVerdict;
  riskLevel: RiskLevel;
  rationale: string;
}

export interface PolicyDecision {
  actionId: string;
  kind: ActionKind;
  verdict: PolicyVerdict;
  riskLevel: RiskLevel;
  riskScore: number;
  findings: readonly PolicyFinding[];
  /** The rule responsible for the final verdict, if a rule drove it. */
  decidingRuleId: string | null;
  explanation: string;
  /** Always false — a decision authorises nothing on its own. */
  autoApproved: false;
}

export class RiskPolicyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'RiskPolicyError';
  }
}

/**
 * Built-in constitutional rules.
 *
 * These encode the project's standing product principles so they are enforced
 * by code rather than by convention.
 */
export function defaultRules(): readonly PolicyRule[] {
  return [
    {
      id: 'no-unreviewed-egress',
      description: 'Network egress always requires explicit human approval.',
      order: 10,
      matches: (action) => action.kind === 'network-egress',
      verdict: 'require-approval',
      riskLevel: 'critical',
      rationale: 'Outbound network access can exfiltrate context and must never be implicit.',
    },
    {
      id: 'no-unreviewed-file-write',
      description: 'File writes always require explicit human approval.',
      order: 11,
      matches: (action) => action.kind === 'file-write',
      verdict: 'require-approval',
      riskLevel: 'critical',
      rationale: 'Local file writes are irreversible from the extension’s perspective.',
    },
    {
      id: 'deny-out-of-scope',
      description: 'Reject actions that reach outside the explicitly scoped context.',
      order: 20,
      matches: (action) => action.outOfScope === true,
      verdict: 'deny',
      riskLevel: 'critical',
      rationale: 'Scoped context is a hard boundary; widening it silently defeats least privilege.',
    },
    {
      id: 'irreversible-requires-justification',
      description: 'Irreversible actions require a recorded justification.',
      order: 30,
      matches: (action) => action.irreversible === true,
      verdict: 'require-justification',
      riskLevel: 'high',
      rationale: 'An irreversible action should carry a written reason for later audit.',
    },
    {
      id: 'tool-execution-approval',
      description: 'Tool execution requires explicit human approval.',
      order: 40,
      matches: (action) => action.kind === 'tool-execution',
      verdict: 'require-approval',
      riskLevel: 'high',
      rationale: 'Tools act on the world; the no-auto-execution default applies.',
    },
    {
      id: 'page-mutation-approval',
      description: 'Mutating Arena page content requires explicit human approval.',
      order: 41,
      matches: (action) => action.kind === 'page-mutation',
      verdict: 'require-approval',
      riskLevel: 'high',
      rationale: 'The extension owns only its own status node; other mutations need review.',
    },
    {
      id: 'expensive-action-approval',
      description: 'Actions above $1.00 require explicit human approval.',
      order: 50,
      matches: (action) => (action.estimatedCostUsd ?? 0) > 1,
      verdict: 'require-approval',
      riskLevel: 'high',
      rationale: 'Spend above the single-action threshold must be confirmed.',
    },
    {
      id: 'costly-action-justification',
      description: 'Actions above $0.25 require a recorded justification.',
      order: 51,
      matches: (action) => (action.estimatedCostUsd ?? 0) > 0.25 && (action.estimatedCostUsd ?? 0) <= 1,
      verdict: 'require-justification',
      riskLevel: 'medium',
      rationale: 'Moderate spend should be explainable after the fact.',
    },
  ];
}

export class RiskPolicyEngine {
  private readonly rules: readonly PolicyRule[];

  public constructor(rules: readonly PolicyRule[] = defaultRules()) {
    if (!Array.isArray(rules)) throw new RiskPolicyError('rules must be an array.');
    if (rules.length > MAX_RULES) throw new RiskPolicyError(`At most ${MAX_RULES} policy rules are supported.`);
    const seen = new Set<string>();
    for (const rule of rules) {
      if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(rule?.id ?? '')) throw new RiskPolicyError('Rule id is invalid.');
      if (seen.has(rule.id)) throw new RiskPolicyError(`Duplicate rule id "${rule.id}".`);
      seen.add(rule.id);
      if (typeof rule.matches !== 'function') throw new RiskPolicyError(`Rule "${rule.id}" requires a matches predicate.`);
      if (!(rule.verdict in VERDICT_RANK)) throw new RiskPolicyError(`Rule "${rule.id}" has an invalid verdict.`);
      if (!(rule.riskLevel in RISK_RANK)) throw new RiskPolicyError(`Rule "${rule.id}" has an invalid risk level.`);
    }
    // Deterministic evaluation order.
    this.rules = [...rules].sort((left, right) => (left.order ?? 100) - (right.order ?? 100) || left.id.localeCompare(right.id));
  }

  public evaluate(action: ProposedAction): PolicyDecision {
    validateAction(action);

    const findings: PolicyFinding[] = [];
    for (const rule of this.rules) {
      let matched = false;
      try {
        matched = rule.matches(action) === true;
      } catch {
        // A throwing predicate must fail closed, never silently skip.
        findings.push({
          ruleId: rule.id,
          verdict: 'deny',
          riskLevel: 'critical',
          rationale: `Rule "${rule.id}" failed to evaluate; failing closed.`,
        });
        continue;
      }
      if (matched) {
        findings.push({ ruleId: rule.id, verdict: rule.verdict, riskLevel: rule.riskLevel, rationale: truncate(rule.rationale) });
      }
    }

    // Most restrictive verdict wins; ties keep the earliest-ordered rule.
    let verdict: PolicyVerdict = 'allow';
    let decidingRuleId: string | null = null;
    for (const finding of findings) {
      if (VERDICT_RANK[finding.verdict] > VERDICT_RANK[verdict]) {
        verdict = finding.verdict;
        decidingRuleId = finding.ruleId;
      }
    }

    // Risk never falls below the action's inherent floor.
    let riskLevel: RiskLevel = INHERENT_RISK[action.kind];
    for (const finding of findings) {
      if (RISK_RANK[finding.riskLevel] > RISK_RANK[riskLevel]) riskLevel = finding.riskLevel;
    }

    return {
      actionId: action.id,
      kind: action.kind,
      verdict,
      riskLevel,
      riskScore: RISK_RANK[riskLevel],
      findings,
      decidingRuleId,
      explanation: buildExplanation(action, verdict, riskLevel, findings),
      autoApproved: false,
    };
  }

  /**
   * Whether a proposed action may proceed, given what the human supplied.
   *
   * Note this still only clears the action to *reach* the normal approval gate.
   */
  public gate(action: ProposedAction, supplied: { approvedByHuman?: boolean; justification?: string } = {}): { permitted: boolean; reason: string; decision: PolicyDecision } {
    const decision = this.evaluate(action);
    if (decision.verdict === 'deny') {
      return { permitted: false, reason: `Policy denies this action: ${decision.explanation}`, decision };
    }
    if (decision.verdict === 'require-approval' && supplied.approvedByHuman !== true) {
      return { permitted: false, reason: 'This action requires explicit human approval.', decision };
    }
    if (decision.verdict === 'require-justification' && (supplied.justification ?? '').trim() === '') {
      return { permitted: false, reason: 'This action requires a recorded justification.', decision };
    }
    return { permitted: true, reason: 'Policy checks passed; the standard approval gate still applies.', decision };
  }

  public listRules(): readonly Omit<PolicyRule, 'matches'>[] {
    return this.rules.map(({ matches: _matches, ...rest }) => ({ ...rest }));
  }
}

function buildExplanation(action: ProposedAction, verdict: PolicyVerdict, riskLevel: RiskLevel, findings: readonly PolicyFinding[]): string {
  if (findings.length === 0) {
    return `No policy rule matched "${action.id}"; inherent risk for ${action.kind} is ${riskLevel}.`;
  }
  return `${verdict} at ${riskLevel} risk — ${findings.map((finding) => finding.ruleId).join(', ')}.`.slice(0, MAX_TEXT_CHARS * 2);
}

function validateAction(action: ProposedAction): void {
  if (!action || typeof action !== 'object') throw new RiskPolicyError('A proposed action is required.');
  if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(action.id ?? '')) throw new RiskPolicyError('Action id is invalid.');
  if (!(action.kind in INHERENT_RISK)) throw new RiskPolicyError(`Unsupported action kind "${String(action.kind)}".`);
  if (typeof action.summary !== 'string' || action.summary.trim() === '') throw new RiskPolicyError('Action summary is required.');
  if (action.estimatedCostUsd !== undefined && (!Number.isFinite(action.estimatedCostUsd) || action.estimatedCostUsd < 0)) {
    throw new RiskPolicyError('estimatedCostUsd must be a non-negative finite number.');
  }
}

function truncate(value: string): string {
  return typeof value === 'string' ? value.slice(0, MAX_TEXT_CHARS) : '';
}
