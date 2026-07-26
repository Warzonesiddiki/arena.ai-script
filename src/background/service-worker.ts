import { BridgeSessionManager } from '../bridge/session-manager';
import { RuntimeStatusStore } from './runtime-status';
import { OrchestrationService } from './orchestration-service';
import {
  isEventMessage,
  isHandshakeRequest,
} from '../bridge/protocol';
import { Tracer } from '../observability/tracer';
import { NotificationCenter } from '../notifications/notification-center';
import { ErrorRecoveryManager } from '../reliability/recovery-manager';

/**
 * Manifest V3 lifecycle entry point.
 *
 * This worker intentionally has no in-memory product state. Manifest V3 workers
 * can be suspended at any time; persistent orchestration state belongs to the
 * Phase 0D storage layer, not module-level variables. The Content Bridge's
 * per-worker sessions are intentionally ephemeral and re-established by the
 * isolated content script whenever it loads.
 */
const HEALTH_CHECK_MESSAGE = 'aamp:health-check';
const RUNTIME_STATUS_MESSAGE = 'aamp:runtime-status';
const runtimeStatus = new RuntimeStatusStore();
const orchestration = new OrchestrationService();
const workerTracer = new Tracer();
const notificationCenter = new NotificationCenter({
  nativeApi: { create: (id, options) => chrome.notifications.create(id, options) },
});
const workerRecovery = new ErrorRecoveryManager({
  tracer: workerTracer,
  notifier: {
    notify: async ({ title, message, correlationId, severity }) => {
      await notificationCenter.notify({
        title,
        message,
        severity,
        groupKey: `recovery:${severity}:${correlationId}`,
      });
    },
  },
});
workerRecovery.installGlobalHandlers(globalThis);
const bridgeSessions = new BridgeSessionManager({
  runtimeId: chrome.runtime.id,
  onAcceptedEvent: (envelope) => runtimeStatus.recordBridgeEvent(envelope),
  sendToTab: (tabId, message, options) => chrome.tabs.sendMessage(tabId, message, options),
});

function logLifecycle(event: string): void {
  const trace = workerTracer.record('worker.lifecycle', 'info', {
    event,
    version: chrome.runtime.getManifest().version,
  });
  console.info(`[AAMP][${trace.correlationId}] ${event}`, {
    version: chrome.runtime.getManifest().version,
    timestamp: new Date().toISOString(),
  });
}

chrome.runtime.onInstalled.addListener(() => {
  logLifecycle('extension installed or updated');

  // A popup remains available for status/settings. Clicking the toolbar action
  // on supporting Chrome versions also opens the persistent Side Panel.
  void chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => workerRecovery.captureGlobal('sidePanel.configure', error));
});

chrome.runtime.onStartup.addListener(() => logLifecycle('browser startup'));

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;

  if (isHealthCheck(message)) {
    sendResponse({
      ok: true,
      version: chrome.runtime.getManifest().version,
      platform: 'manifest-v3',
    });
    return;
  }

  if (isOrchestrationRequest(message)) {
    try { sendResponse({ ok: true, orchestration: message.type === 'aamp:orchestration:create' ? orchestration.create(message.goal) : message.type === 'aamp:orchestration:approve' ? orchestration.approve(message.taskId) : orchestration.snapshot() }); }
    catch (error) { sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Orchestration request failed.' }); }
    return;
  }

  if (isRuntimeStatusRequest(message)) {
    sendResponse({ ok: true, status: runtimeStatus.get(chrome.runtime.getManifest().version) });
    return;
  }

  if (!isHandshakeRequest(message) && !isEventMessage(message)) return;

  void bridgeSessions.handleMessage(message, sender)
    .then((response) => sendResponse(response ?? { ok: false, code: 'invalid-message' }))
    .catch((error: unknown) => {
      workerRecovery.captureGlobal('bridge.handleMessage', error);
      sendResponse({ ok: false, code: 'operation-failed' });
    });
  return true;
});

function isOrchestrationRequest(message: unknown): message is { type: 'aamp:orchestration:create'; goal: string } | { type: 'aamp:orchestration:approve'; taskId: string } | { type: 'aamp:orchestration:status' } {
  if (typeof message !== 'object' || message === null) return false; const value = message as { type?: unknown; goal?: unknown; taskId?: unknown };
  return (value.type === 'aamp:orchestration:create' && typeof value.goal === 'string' && value.goal.length <= 4000) || (value.type === 'aamp:orchestration:approve' && typeof value.taskId === 'string') || value.type === 'aamp:orchestration:status';
}

function isRuntimeStatusRequest(message: unknown): message is { type: typeof RUNTIME_STATUS_MESSAGE } {
  return typeof message === 'object'
    && message !== null
    && Object.keys(message).length === 1
    && 'type' in message
    && (message as { type?: unknown }).type === RUNTIME_STATUS_MESSAGE;
}

function isHealthCheck(message: unknown): message is { type: typeof HEALTH_CHECK_MESSAGE } {
  return typeof message === 'object'
    && message !== null
    && 'type' in message
    && (message as { type?: unknown }).type === HEALTH_CHECK_MESSAGE;
}
