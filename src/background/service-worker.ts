import { BridgeSessionManager } from '../bridge/session-manager';
import { RuntimeStatusStore } from './runtime-status';
import { OrchestrationService } from './orchestration-service';
import { GovernedOrchestration } from './governed-orchestration';
import { InsightService } from './insight-service';
import { isOrchestrationRequest } from './orchestration-messages';
import { ScheduledAgentManager } from '../scheduling/schedule-manager';
import { TriggerManager } from '../triggers/trigger-manager';
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
 * Manifest V3 workers can be suspended at any time. The active Phase 3E
 * dashboard state and Content Bridge sessions are intentionally ephemeral;
 * durable orchestration history belongs to the Phase 0D storage layer and later
 * memory phases, not module-level variables.
 */
const HEALTH_CHECK_MESSAGE = 'aamp:health-check';
const RUNTIME_STATUS_MESSAGE = 'aamp:runtime-status';
const runtimeStatus = new RuntimeStatusStore();
const workerTracer = new Tracer();
const orchestration = new OrchestrationService({ tracer: workerTracer });
const scheduledAgents = new ScheduledAgentManager();
const triggers = new TriggerManager();
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
const governedOrchestration = new GovernedOrchestration({
  orchestration,
  onPersistError: (scope, error) => workerRecovery.captureGlobal(scope, error),
});
const insights = new InsightService({ tracer: workerTracer });
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

chrome.runtime.onStartup.addListener(() => {
  logLifecycle('browser startup');
  // Phase 5A: restore bounded control-plane visibility after a suspension.
  void governedOrchestration.restore().catch((error: unknown) => workerRecovery.captureGlobal('orchestration.restore', error));
});

chrome.alarms.onAlarm.addListener((alarm) => {
  void scheduledAgents.handleAlarm(alarm.name)
    .then(async (dueRun) => {
      if (!dueRun) return;
      // Phase 5C: an internal schedule due run may only create further
      // approval-required trigger due runs. Nothing is executed here.
      await triggers.dispatch({
        type: 'schedule-due-run-created',
        scheduleId: dueRun.scheduleId,
        dueRunId: dueRun.id,
        observedAt: dueRun.firedAt,
      });
    })
    .catch((error: unknown) => workerRecovery.captureGlobal('scheduledAgents.handleAlarm', error));
});

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
    // Every create/approve now passes the Phase 11 policy gate and leaves a
    // Phase 10 audit record, then persists Phase 5A durable control state.
    const request = message;
    void (async (): Promise<void> => {
      if (request.type === 'aamp:orchestration:insights') {
        const snapshot = orchestration.snapshot(false);
        sendResponse({ ok: true, insights: await insights.build(snapshot) });
        return;
      }
      const result = request.type === 'aamp:orchestration:create'
        ? await governedOrchestration.create(request.goal)
        : request.type === 'aamp:orchestration:approve'
          ? await governedOrchestration.approve(request.taskId)
          : governedOrchestration.status();
      sendResponse(result);
    })().catch((error: unknown) => {
      workerRecovery.captureGlobal('orchestration.request', error);
      sendResponse({ ok: false, error: 'Orchestration request failed.' });
    });
    return true;
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
