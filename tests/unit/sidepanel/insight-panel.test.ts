import { isInsightResponse, renderInsightPanel, type InsightPayload } from '../../../src/sidepanel/insight-panel';

function payload(overrides: Partial<InsightPayload> = {}): InsightPayload {
  return {
    focus: {
      level: 'balanced',
      headline: 'Coder task failed',
      quiet: false,
      hiddenCount: 2,
      items: [{ id: 'focus:failed-task:coder-1', kind: 'failed-task', title: 'Coder task failed', detail: 'Implement approved plan', actionable: false, suggestedAction: 'Review the failure trace.' }],
    },
    health: { status: 'critical', issues: [{ id: 'i1', severity: 'critical', summary: 'A task failed' }] },
    recovery: { snapshotId: 'snap-1', confidence: 'high', progressLossCount: 0, steps: [{ order: 1, kind: 'resume-from-snapshot', summary: 'Restore from snap-1.' }] },
    cost: { status: 'warning', stopRecommended: false, usageRatio: 0.85, remainingUsd: 0.07, alertCount: 1 },
    replay: { totalEvents: 12, errorCount: 1 },
    ...overrides,
  };
}

describe('insight panel', () => {
  beforeEach(() => { document.body.innerHTML = '<div id="insight-panel"></div>'; });

  it('accepts a well-formed payload and rejects malformed ones', () => {
    expect(isInsightResponse({ ok: true, insights: payload() })).toBe(true);
    expect(isInsightResponse({ ok: false, insights: payload() })).toBe(false);
    expect(isInsightResponse(null)).toBe(false);
    expect(isInsightResponse({ ok: true })).toBe(false);
    expect(isInsightResponse({ ok: true, insights: { ...payload(), focus: null } })).toBe(false);
    expect(isInsightResponse({ ok: true, insights: { ...payload(), health: { status: 1, issues: [] } } })).toBe(false);
    expect(isInsightResponse({ ok: true, insights: { ...payload(), recovery: { steps: 'nope', confidence: 'high' } } })).toBe(false);
    expect(isInsightResponse({ ok: true, insights: { ...payload(), replay: { totalEvents: 'lots' } } })).toBe(false);
    expect(isInsightResponse({ ok: true, insights: { ...payload(), cost: 'free' } })).toBe(false);
    // A null cost is valid: it means no active workflow.
    expect(isInsightResponse({ ok: true, insights: { ...payload(), cost: null } })).toBe(true);
  });

  it('rejects an unbounded or malformed focus item list', () => {
    const many = Array.from({ length: 21 }, (_unused, index) => ({
      id: `i${index}`, kind: 'idle', title: 't', detail: 'd', actionable: false, suggestedAction: null,
    }));
    expect(isInsightResponse({ ok: true, insights: { ...payload(), focus: { ...payload().focus, items: many } } })).toBe(false);
    expect(isInsightResponse({ ok: true, insights: { ...payload(), focus: { ...payload().focus, items: [{ title: 1 }] } } })).toBe(false);
  });

  it('renders every section as text nodes', () => {
    const container = document.getElementById('insight-panel');
    renderInsightPanel(document, container, payload());

    const headings = Array.from(document.querySelectorAll('.aamp-insight-section h3')).map((node) => node.textContent);
    expect(headings).toEqual(['Focus', 'Health', 'Recovery', 'Cost', 'Traces']);
    expect(document.querySelector('.aamp-focus-headline')?.textContent).toBe('Coder task failed');
    expect(document.querySelector('.aamp-focus-action')?.textContent).toContain('Suggested:');
    expect(document.querySelector('.aamp-focus-more')?.textContent).toBe('+2 more');
    expect(document.querySelector('.aamp-health-issue')?.textContent).toBe('[critical] A task failed');
    expect(document.querySelector('.aamp-recovery-summary')?.textContent).toContain('snap-1');
    expect(document.querySelector('.aamp-cost-line')?.textContent).toContain('85% committed');
    expect(document.querySelector('.aamp-replay-line')?.textContent).toBe('12 event(s), 1 error(s)');
  });

  it('never lets worker-supplied text become markup', () => {
    const container = document.getElementById('insight-panel');
    renderInsightPanel(document, container, payload({
      focus: {
        level: 'minimal', headline: '<img src=x onerror=alert(1)>', quiet: false, hiddenCount: 0,
        items: [{ id: 'i', kind: 'idle', title: '<script>bad()</script>', detail: '<b>d</b>', actionable: false, suggestedAction: null }],
      },
    }));

    expect(container!.querySelector('img')).toBeNull();
    expect(container!.querySelector('script')).toBeNull();
    expect(container!.querySelector('b')).toBeNull();
    expect(document.querySelector('.aamp-focus-headline')?.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('handles a quiet state, a missing snapshot, and no active workflow', () => {
    const container = document.getElementById('insight-panel');
    renderInsightPanel(document, container, payload({
      focus: { level: 'minimal', headline: 'Nothing needs attention', quiet: true, hiddenCount: 0, items: [] },
      recovery: { snapshotId: null, confidence: 'low', progressLossCount: 0, steps: [] },
      cost: null,
    }));

    expect(document.querySelector('.aamp-focus-more')).toBeNull();
    expect(document.querySelector('.aamp-recovery-summary')?.textContent).toBe('No clean recovery snapshot yet.');
    expect(document.querySelector('.aamp-cost-line')?.textContent).toBe('No active workflow.');
  });

  it('replaces prior content and tolerates a missing container', () => {
    const container = document.getElementById('insight-panel')!;
    container.textContent = 'stale';
    renderInsightPanel(document, container, payload());
    expect(container.textContent).not.toContain('stale');

    expect(() => renderInsightPanel(document, null, payload())).not.toThrow();
  });

  it('bounds long issue and step lists', () => {
    const container = document.getElementById('insight-panel');
    renderInsightPanel(document, container, payload({
      health: { status: 'critical', issues: Array.from({ length: 9 }, (_u, i) => ({ id: `i${i}`, severity: 'warning', summary: `s${i}` })) },
      recovery: { snapshotId: 's', confidence: 'low', progressLossCount: 1, steps: Array.from({ length: 9 }, (_u, i) => ({ order: i, kind: 'k', summary: `st${i}` })) },
    }));

    expect(document.querySelectorAll('.aamp-health-issue')).toHaveLength(5);
    expect(document.querySelectorAll('.aamp-recovery-step')).toHaveLength(5);
  });
});
