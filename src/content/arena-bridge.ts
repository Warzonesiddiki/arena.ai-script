import {
  BridgeMessageType,
  isHandshakeResponse,
  type BridgeResponse,
} from '../bridge/protocol';
import { ContentBridge } from '../bridge/content-bridge';
import { EventBus } from '../core/event-bus';
import { DomObserverV2, findArenaRoot, type DomObserverEvents } from '../observability/dom-observer';

/**
 * Phase 0C isolated-world entry point. It deliberately offers no window event,
 * CustomEvent, DOM attribute, or injected-script API to page JavaScript.
 */
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
    console.warn('[AAMP] Content Bridge initialization failed.', error);
  }
}

let domObserver: DomObserverV2 | null = null;

function startScopedObservation(): void {
  if (domObserver) return;
  const root = findArenaRoot(document);
  if (!root) return;

  // Event consumers (tracing in Phase 1D) attach to this v7.2-compatible bus;
  // the observer never falls back to document.body when Arena has no main root.
  const eventBus = new EventBus<DomObserverEvents>();
  domObserver = new DomObserverV2({ eventBus });
  domObserver.start(root);
}
