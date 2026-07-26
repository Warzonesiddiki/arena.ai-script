import { RuntimeStatusStore } from '../../../src/background/runtime-status';
import type { SignedBridgeEnvelope } from '../../../src/bridge/protocol';

const snapshot = { title: 'Arena Agent', path: '/agent/task', isAgentMode: true };
const readyEnvelope: SignedBridgeEnvelope = {
  protocol: 1,
  sessionId: 'MDEyMzQ1Njc4OWFiY2RlZmdoaWprbG1ub3A',
  messageId: 'MDEyMzQ1Njc4OWFi',
  timestamp: 1_700_000_000_000,
  direction: 'content-to-worker',
  operation: 'bridge.ready',
  payload: { snapshot },
  signature: 'a'.repeat(44),
};

describe('RuntimeStatusStore', () => {
  it('retains only the privacy-minimized ready snapshot for the Side Panel', () => {
    const store = new RuntimeStatusStore();
    store.recordBridgeEvent(readyEnvelope);

    expect(store.get('8.0.0')).toEqual({
      version: '8.0.0',
      bridge: {
        connected: true,
        sessionId: readyEnvelope.sessionId,
        lastUpdatedAt: readyEnvelope.timestamp,
        snapshot,
      },
    });
  });

  it('ignores unrelated bridge events and clears ephemeral status', () => {
    const store = new RuntimeStatusStore();
    store.recordBridgeEvent({ ...readyEnvelope, operation: 'page.snapshot', payload: {} });
    expect(store.get('8.0.0').bridge.connected).toBe(false);

    store.recordBridgeEvent(readyEnvelope);
    store.clear();
    expect(store.get('8.0.0').bridge).toEqual({ connected: false, sessionId: null, lastUpdatedAt: null, snapshot: null });
  });
});
