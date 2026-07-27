import { openCommandPalette } from '../commands/command-palette-modal';
import { TickDispatcher } from '../core/tick-dispatcher';
import { isOrchestrationResponse, renderOrchestrationDashboard } from './orchestration-dashboard';

interface RuntimeStatusResponse {
  ok: true;
  status: {
    version: string;
    bridge: {
      connected: boolean;
      lastUpdatedAt: number | null;
      snapshot: { title: string; path: string; isAgentMode: boolean } | null;
    };
  };
}

const refreshButton = document.getElementById('refresh-status') as HTMLButtonElement | null;
const commandButton = document.getElementById('open-command-palette') as HTMLButtonElement | null;
const statusText = document.getElementById('sidepanel-status');
const indicator = document.getElementById('bridge-indicator');
const arenaMode = document.getElementById('arena-mode');
const arenaPath = document.getElementById('arena-path');
const arenaUpdated = document.getElementById('arena-updated');
const ticks = new TickDispatcher({ cadenceMs: 1_000 });

refreshButton?.addEventListener('click', () => { void refreshStatus(); });
commandButton?.addEventListener('click', () => {
  openCommandPalette(document, [
    { id: 'status.refresh', title: 'Refresh status', description: 'Update scoped Arena connection status', category: 'Status' },
    { id: 'settings.open', title: 'Open settings', description: 'Configure extension preferences', category: 'Extension', keywords: ['preferences'] },
  ], (commandId) => {
    if (commandId === 'status.refresh') void refreshStatus();
    if (commandId === 'settings.open') window.open('../options/options.html', '_blank', 'noopener');
  });
});
ticks.register('sidepanel-status', () => { void refreshStatus(); }, 1_000);
ticks.start();
window.addEventListener('pagehide', () => ticks.stop(), { once: true });
void refreshStatus();

async function refreshStatus(): Promise<void> {
  try {
    const response: unknown = await chrome.runtime.sendMessage({ type: 'aamp:runtime-status' });
    if (!isRuntimeStatusResponse(response)) throw new Error('Invalid runtime status response.');

    const { bridge } = response.status;
    const connected = bridge.connected && bridge.snapshot !== null;
    setText(statusText, `Service worker ready · v${response.status.version}`);
    setState(statusText, 'ready');
    setText(indicator, connected ? 'Connected' : 'Waiting for Arena');
    setState(indicator, connected ? 'connected' : 'disconnected');
    setText(arenaMode, connected && bridge.snapshot?.isAgentMode ? 'Agent Mode' : connected ? 'Arena page' : 'Not connected');
    setText(arenaPath, bridge.snapshot?.path ?? 'Open an Arena.ai tab');
    setText(arenaUpdated, formatTimestamp(bridge.lastUpdatedAt));
  } catch (error) {
    console.warn('[AAMP] Side Panel status refresh failed.', error);
    setText(statusText, 'Extension service is unavailable. Reload the extension and try again.');
    setState(statusText, 'error');
    setText(indicator, 'Unavailable');
    setState(indicator, 'error');
  }
}

function isRuntimeStatusResponse(value: unknown): value is RuntimeStatusResponse {
  if (typeof value !== 'object' || value === null) return false;
  const response = value as { ok?: unknown; status?: unknown };
  if (response.ok !== true || typeof response.status !== 'object' || response.status === null) return false;
  const status = response.status as { version?: unknown; bridge?: unknown };
  if (typeof status.version !== 'string' || typeof status.bridge !== 'object' || status.bridge === null) return false;
  const bridge = status.bridge as { connected?: unknown; lastUpdatedAt?: unknown; snapshot?: unknown };
  return typeof bridge.connected === 'boolean'
    && (bridge.lastUpdatedAt === null || typeof bridge.lastUpdatedAt === 'number')
    && (bridge.snapshot === null || isSnapshot(bridge.snapshot));
}

function isSnapshot(value: unknown): value is { title: string; path: string; isAgentMode: boolean } {
  if (typeof value !== 'object' || value === null) return false;
  const snapshot = value as { title?: unknown; path?: unknown; isAgentMode?: unknown };
  return typeof snapshot.title === 'string' && typeof snapshot.path === 'string' && typeof snapshot.isAgentMode === 'boolean';
}

function setText(element: HTMLElement | null, value: string): void {
  if (element) element.textContent = value;
}

function setState(element: HTMLElement | null, state: string): void {
  if (element) element.dataset.state = state;
}

function formatTimestamp(timestamp: number | null): string {
  if (timestamp === null) return '—';
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString();
}

const planButton = document.getElementById('create-orchestration') as HTMLButtonElement | null;
const goalInput = document.getElementById('orchestration-goal') as HTMLInputElement | null;
const dashboard = document.getElementById('agent-dashboard');
const agentCost = document.getElementById('agent-cost');
planButton?.addEventListener('click', () => { if (goalInput?.value.trim()) void orchestrationRequest({ type: 'aamp:orchestration:create', goal: goalInput.value.trim() }); });
void orchestrationRequest({ type: 'aamp:orchestration:status' });
async function orchestrationRequest(message: unknown): Promise<void> {
  try {
    const response: unknown = await chrome.runtime.sendMessage(message);
    if (!isOrchestrationResponse(response)) return;
    renderOrchestrationDashboard(document, { dashboard, agentCost }, response.orchestration, (taskId) => {
      void orchestrationRequest({ type: 'aamp:orchestration:approve', taskId });
    });
  } catch (error) {
    console.warn('[AAMP] Orchestration dashboard refresh failed.', error);
  }
}
