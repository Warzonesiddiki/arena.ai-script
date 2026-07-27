/**
 * Side Panel insight renderer.
 *
 * Validates the worker's insight payload before rendering and builds every node
 * with `createElement`/`textContent`, so no worker or page value can become
 * markup. Rendering is presentation only: it triggers nothing.
 */

export interface InsightPayload {
  focus: {
    level: string;
    headline: string;
    quiet: boolean;
    hiddenCount: number;
    items: readonly { id: string; kind: string; title: string; detail: string; actionable: boolean; suggestedAction: string | null }[];
  };
  health: { status: string; issues: readonly { id: string; severity: string; summary: string }[] };
  recovery: { snapshotId: string | null; confidence: string; progressLossCount: number; steps: readonly { order: number; kind: string; summary: string }[] };
  cost: { status: string; stopRecommended: boolean; usageRatio: number; remainingUsd: number; alertCount: number } | null;
  replay: { totalEvents: number; errorCount: number };
}

export interface InsightResponse {
  ok: true;
  insights: InsightPayload;
}

export function isInsightResponse(value: unknown): value is InsightResponse {
  if (typeof value !== 'object' || value === null) return false;
  const response = value as { ok?: unknown; insights?: unknown };
  if (response.ok !== true || typeof response.insights !== 'object' || response.insights === null) return false;

  const insights = response.insights as Partial<InsightPayload>;
  const focus = insights.focus;
  if (typeof focus !== 'object' || focus === null) return false;
  if (typeof focus.headline !== 'string' || typeof focus.quiet !== 'boolean' || !Array.isArray(focus.items)) return false;
  if (focus.items.length > 20) return false;
  for (const item of focus.items) {
    if (typeof item?.title !== 'string' || typeof item.detail !== 'string' || typeof item.kind !== 'string') return false;
  }

  const health = insights.health;
  if (typeof health !== 'object' || health === null || typeof health.status !== 'string' || !Array.isArray(health.issues)) return false;

  const recovery = insights.recovery;
  if (typeof recovery !== 'object' || recovery === null || !Array.isArray(recovery.steps)) return false;
  if (typeof recovery.confidence !== 'string') return false;

  const replay = insights.replay;
  if (typeof replay !== 'object' || replay === null || !Number.isFinite(replay.totalEvents)) return false;

  const cost = insights.cost;
  if (cost !== null && (typeof cost !== 'object' || typeof (cost as { status?: unknown }).status !== 'string')) return false;

  return true;
}

export function renderInsightPanel(documentRef: Document, container: HTMLElement | null, payload: InsightPayload): void {
  if (!container) return;
  container.replaceChildren();

  container.append(
    section(documentRef, 'Focus', [
      line(documentRef, payload.focus.headline, 'aamp-focus-headline'),
      ...payload.focus.items.map((item) => {
        const row = documentRef.createElement('div');
        row.className = 'aamp-focus-item';
        row.dataset.kind = item.kind;
        row.dataset.actionable = String(item.actionable);
        row.append(line(documentRef, item.title, 'aamp-focus-title'), line(documentRef, item.detail, 'aamp-focus-detail'));
        if (item.suggestedAction) row.append(line(documentRef, `Suggested: ${item.suggestedAction}`, 'aamp-focus-action'));
        return row;
      }),
      ...(payload.focus.hiddenCount > 0 ? [line(documentRef, `+${payload.focus.hiddenCount} more`, 'aamp-focus-more')] : []),
    ]),
    section(documentRef, 'Health', [
      badge(documentRef, payload.health.status),
      ...payload.health.issues.slice(0, 5).map((issue) => line(documentRef, `[${issue.severity}] ${issue.summary}`, 'aamp-health-issue')),
    ]),
    section(documentRef, 'Recovery', [
      line(documentRef, payload.recovery.snapshotId
        ? `Snapshot ${payload.recovery.snapshotId} · ${payload.recovery.confidence} confidence · would regress ${payload.recovery.progressLossCount} task(s)`
        : 'No clean recovery snapshot yet.', 'aamp-recovery-summary'),
      ...payload.recovery.steps.slice(0, 5).map((step) => line(documentRef, `${step.order}. ${step.summary}`, 'aamp-recovery-step')),
    ]),
    section(documentRef, 'Cost', [
      payload.cost
        ? line(documentRef, `${payload.cost.status} · ${Math.round(payload.cost.usageRatio * 100)}% committed · $${payload.cost.remainingUsd.toFixed(2)} left${payload.cost.stopRecommended ? ' · stop recommended' : ''}`, 'aamp-cost-line')
        : line(documentRef, 'No active workflow.', 'aamp-cost-line'),
    ]),
    section(documentRef, 'Traces', [
      line(documentRef, `${payload.replay.totalEvents} event(s), ${payload.replay.errorCount} error(s)`, 'aamp-replay-line'),
    ]),
  );
}

function section(documentRef: Document, title: string, children: readonly Node[]): HTMLElement {
  const element = documentRef.createElement('section');
  element.className = 'aamp-insight-section';
  const heading = documentRef.createElement('h3');
  heading.textContent = title;
  element.append(heading, ...children);
  return element;
}

function line(documentRef: Document, text: string, className: string): HTMLElement {
  const element = documentRef.createElement('p');
  element.className = className;
  // textContent, never innerHTML: worker output can never become markup.
  element.textContent = text;
  return element;
}

function badge(documentRef: Document, status: string): HTMLElement {
  const element = documentRef.createElement('span');
  element.className = 'aamp-indicator';
  element.dataset.state = status;
  element.textContent = status;
  return element;
}
