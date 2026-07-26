import {
  BridgeMessageType,
  isHandshakeResponse,
  type BridgeResponse,
} from '../bridge/protocol';
import { ContentBridge } from '../bridge/content-bridge';
import { EventBus } from '../core/event-bus';
import { DomObserverV2, findArenaRoot, type DomObserverEvents } from '../observability/dom-observer';
import { PerformanceMonitor } from '../observability/performance-monitor';
import { Tracer } from '../observability/tracer';
import { ErrorRecoveryManager } from '../reliability/recovery-manager';
import { setExtensionStatus } from '../bridge/safe-dom';

/**
 * Phase 0C isolated-world entry point. It deliberately offers no window event,
 * CustomEvent, DOM attribute, or injected-script API to page JavaScript.
 */
const contentTracer = new Tracer();
const contentRecovery = new ErrorRecoveryManager({
  tracer: contentTracer,
  notifier: {
    notify: ({ message, severity }) => {
      if (document.body) setExtensionStatus(document, message, severity);
    },
  },
});
contentRecovery.installGlobalHandlers(window);

void initialiseContentBridge();

async function initialiseContentBridge(): Promise<void> {
  try {
    const response: unknown = await chrome.runtime.sendMessage({
      type: BridgeMessageType.handshake,
      protocol: 1,
    });
    if (!isHandshakeResponse(response)) {
      console.warn('[AAMP] Content Bridge handshake was rejected.');
      return;
    }

    const bridge = new ContentBridge(response, {
      document,
      location,
      runtime: chrome.runtime,
    });

    chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
      if (typeof message !== 'object' || message === null || (message as { type?: unknown }).type !== BridgeMessageType.command) {
        return;
      }

      void bridge.handleCommand(message, sender)
        .then((result: BridgeResponse) => sendResponse(result))
        .catch(() => sendResponse({ ok: false, code: 'operation-failed' }));
      return true;
    });

    const readyResult = await bridge.announceReady();
    if (!readyResult.ok) console.warn('[AAMP] Content Bridge ready event was rejected.', readyResult.code);
    startScopedObservation();
  } catch (error) {
    // A page must continue to work normally if the extension worker is unavailable.
    contentRecovery.captureGlobal('contentBridge.initialize', error);
  }
}

let domObserver: DomObserverV2 | null = null;

function startScopedObservation(): void {
  if (domObserver) return;
  const root = findArenaRoot(document);
  if (!root) return;

  // The observer never falls back to document.body when Arena has no main root.
  const eventBus = new EventBus<DomObserverEvents>();
  const performanceMonitor = new PerformanceMonitor();
  eventBus.on('dom:mutation', ({ node, mutations, timestamp }) => {
    const { count, overBudget } = performanceMonitor.recordMutation();
    contentTracer.record('dom.mutation', overBudget ? 'warn' : 'debug', {
      nodeType: node.nodeType,
      mutationCount: mutations.length,
      observerTimestamp: timestamp,
      mutationsInWindow: count,
      overBudget,
    });
  });
  domObserver = new DomObserverV2({ eventBus });
  domObserver.start(root);
}
