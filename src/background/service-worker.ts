/**
 * Manifest V3 lifecycle entry point.
 *
 * This worker intentionally has no in-memory product state. Manifest V3 workers
 * can be suspended at any time; persistent orchestration state belongs to the
 * Phase 0D storage layer, not module-level variables.
 */
const HEALTH_CHECK_MESSAGE = 'aamp:health-check';

function logLifecycle(event: string): void {
  console.info(`[AAMP] ${event}`, {
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
    .catch((error: unknown) => console.warn('[AAMP] Unable to configure Side Panel behavior.', error));
});

chrome.runtime.onStartup.addListener(() => logLifecycle('browser startup'));

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !isHealthCheck(message)) return;

  sendResponse({
    ok: true,
    version: chrome.runtime.getManifest().version,
    platform: 'manifest-v3',
  });
});

function isHealthCheck(message: unknown): message is { type: typeof HEALTH_CHECK_MESSAGE } {
  return typeof message === 'object'
    && message !== null
    && 'type' in message
    && (message as { type?: unknown }).type === HEALTH_CHECK_MESSAGE;
}

// Marks this lifecycle entry point as an ES module for TypeScript and MV3.
export {};
