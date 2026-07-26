import {
  BridgeMessageType,
  createEnvelope,
  isCommandMessage,
  signEnvelope,
  type BridgeErrorCode,
  type BridgeHandshakeResponse,
  type BridgeResponse,
  verifyEnvelope,
} from './protocol';
import { readPageSnapshot, removeExtensionStatus, setExtensionStatus } from './safe-dom';

export interface ContentBridgeDependencies {
  document: Document;
  location: Location;
  runtime: Pick<typeof chrome.runtime, 'id' | 'sendMessage'>;
}

/**
 * Isolated-world endpoint for worker-issued, signed and allow-listed commands.
 * This class has no window messaging surface and deliberately exposes no DOM
 * selector or HTML execution capability.
 */
export class ContentBridge {
  public constructor(
    private readonly session: BridgeHandshakeResponse,
    private readonly dependencies: ContentBridgeDependencies,
  ) {}

  public async announceReady(): Promise<BridgeResponse> {
    const snapshot = readPageSnapshot(this.dependencies.document, this.dependencies.location);
    const envelope = await signEnvelope(
      createEnvelope(this.session.sessionId, 'content-to-worker', 'bridge.ready', { snapshot }),
      this.session.secret,
    );
    return this.dependencies.runtime.sendMessage({ type: BridgeMessageType.event, envelope }) as Promise<BridgeResponse>;
  }

  public async handleCommand(rawMessage: unknown, sender: chrome.runtime.MessageSender): Promise<BridgeResponse> {
    if (sender.id !== this.dependencies.runtime.id || !isCommandMessage(rawMessage)) return { ok: false, code: 'invalid-message' };

    const { envelope } = rawMessage;
    if (envelope.sessionId !== this.session.sessionId) return { ok: false, code: 'invalid-session' };
    if (envelope.direction !== 'worker-to-content') return { ok: false, code: 'invalid-message' };
    if (!await verifyEnvelope(envelope, this.session.secret)) return { ok: false, code: 'invalid-signature' };

    try {
      const result = this.runAllowListedOperation(envelope.operation, envelope.payload);
      const response = await signEnvelope(
        createEnvelope(
          this.session.sessionId,
          'content-to-worker',
          envelope.operation,
          { ok: true, result },
        ),
        this.session.secret,
      );
      return { ok: true, envelope: response };
    } catch {
      return this.signFailure(envelope.operation, 'operation-failed');
    }
  }

  private runAllowListedOperation(operation: string, payload: unknown): ReturnType<typeof readPageSnapshot> | Record<string, never> {
    if (operation === 'page.snapshot') return readPageSnapshot(this.dependencies.document, this.dependencies.location);
    if (operation === 'overlay.setStatus' && isStatusPayload(payload)) {
      setExtensionStatus(this.dependencies.document, payload.message, payload.level);
      return {};
    }
    if (operation === 'overlay.removeStatus') {
      removeExtensionStatus(this.dependencies.document);
      return {};
    }
    throw new Error('Unsupported bridge operation.');
  }

  private async signFailure(operation: 'page.snapshot' | 'overlay.setStatus' | 'overlay.removeStatus' | 'bridge.ready', code: BridgeErrorCode): Promise<BridgeResponse> {
    const response = await signEnvelope(
      createEnvelope(this.session.sessionId, 'content-to-worker', operation, { ok: false, code }),
      this.session.secret,
    );
    return { ok: true, envelope: response };
  }
}

function isStatusPayload(value: unknown): value is { message: string; level: 'info' | 'warning' | 'error' } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return Object.keys(payload).length === 2
    && typeof payload.message === 'string'
    && payload.message.length <= 500
    && (payload.level === 'info' || payload.level === 'warning' || payload.level === 'error');
}
