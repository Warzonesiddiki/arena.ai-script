export const ORCHESTRATION_CREATE_MESSAGE = 'aamp:orchestration:create';
export const ORCHESTRATION_APPROVE_MESSAGE = 'aamp:orchestration:approve';
export const ORCHESTRATION_STATUS_MESSAGE = 'aamp:orchestration:status';

export type OrchestrationRequest =
  | { type: typeof ORCHESTRATION_CREATE_MESSAGE; goal: string }
  | { type: typeof ORCHESTRATION_APPROVE_MESSAGE; taskId: string }
  | { type: typeof ORCHESTRATION_STATUS_MESSAGE };

const PHASE3_TASK_ID_PATTERN = /^(planner|coder|critic)-[1-9][0-9]{0,2}$/u;

export function isOrchestrationRequest(message: unknown): message is OrchestrationRequest {
  if (typeof message !== 'object' || message === null || Array.isArray(message)) return false;
  const record = message as Record<string, unknown>;

  if (record.type === ORCHESTRATION_CREATE_MESSAGE) {
    return hasOnlyKeys(record, ['type', 'goal'])
      && typeof record.goal === 'string'
      && record.goal.trim().length > 0
      && record.goal.length <= 4_000;
  }

  if (record.type === ORCHESTRATION_APPROVE_MESSAGE) {
    return hasOnlyKeys(record, ['type', 'taskId'])
      && typeof record.taskId === 'string'
      && PHASE3_TASK_ID_PATTERN.test(record.taskId);
  }

  return record.type === ORCHESTRATION_STATUS_MESSAGE && hasOnlyKeys(record, ['type']);
}

function hasOnlyKeys(record: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const keys = Object.keys(record);
  return keys.length === expectedKeys.length && expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(record, key));
}
