import { BridgeSessionManager } from '../bridge/session-manager';
import {
  isEventMessage,
  isHandshakeRequest,
} from '../bridge/protocol';
import { Tracer } from '../observability/tracer';
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
const workerTracer = new Tracer();
const workerRecovery = new ErrorRecoveryManager({
  tracer: workerTracer,
  notifier: {
    notify: ({ message, correlationId, severity }) => console.warn(`[AAMP][${severity}][${correlationId}] ${message}`),
  },
});
workerRecovery.installGlobalHandlers(globalThis);
const bridgeSessions = new BridgeSessionManager({
  runtimeId: chrome.runtime.id,
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

  if (!isHandshakeRequest(message) && !isEventMessage(message)) return;

  void bridgeSessions.handleMessage(message, sender)
    .then((response) => sendResponse(response ?? { ok: false, code: 'invalid-message' }))
    .catch((error: unknown) => {
      workerRecovery.captureGlobal('bridge.handleMessage', error);
      sendResponse({ ok: false, code: 'operation-failed' });
    });
  return true;
});

function isHealthCheck(message: unknown): message is { type: typeof HEALTH_CHECK_MESSAGE } {
  return typeof message === 'object'
    && message !== null
    && 'type' in message
    && (message as { type?: unknown }).type === HEALTH_CHECK_MESSAGE;
}
