import type { PageSnapshot, SignedBridgeEnvelope } from '../bridge/protocol';

export interface RuntimeBridgeStatus {
  connected: boolean;
  sessionId: string | null;
  lastUpdatedAt: number | null;
  snapshot: PageSnapshot | null;
}

export interface RuntimeStatus {
  version: string;
  bridge: RuntimeBridgeStatus;
}

/** Ephemeral, privacy-minimized state intended for the Side Panel. */
export class RuntimeStatusStore {
  private bridge: RuntimeBridgeStatus = {
    connected: false,
    sessionId: null,
    lastUpdatedAt: null,
    snapshot: null,
  };

  public recordBridgeEvent(envelope: SignedBridgeEnvelope): void {
    if (envelope.operation !== 'bridge.ready' || !isReadyPayload(envelope.payload)) return;
    this.bridge = {
      connected: true,
      sessionId: envelope.sessionId,
      lastUpdatedAt: envelope.timestamp,
      snapshot: envelope.payload.snapshot,
    };
  }

  public get(version: string): RuntimeStatus {
    return {
      version,
      bridge: {
        connected: this.bridge.connected,
        sessionId: this.bridge.sessionId,
        lastUpdatedAt: this.bridge.lastUpdatedAt,
        snapshot: this.bridge.snapshot ? { ...this.bridge.snapshot } : null,
      },
    };
  }

  public clear(): void {
    this.bridge = { connected: false, sessionId: null, lastUpdatedAt: null, snapshot: null };
  }
}

function isReadyPayload(payload: unknown): payload is { snapshot: PageSnapshot } {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return false;
  const record = payload as Record<string, unknown>;
  const snapshot = record.snapshot;
  return Object.keys(record).length === 1
    && typeof snapshot === 'object'
    && snapshot !== null
    && !Array.isArray(snapshot)
    && typeof (snapshot as Record<string, unknown>).title === 'string'
    && typeof (snapshot as Record<string, unknown>).path === 'string'
    && typeof (snapshot as Record<string, unknown>).isAgentMode === 'boolean';
}
