import {
  BRIDGE_MAX_AGE_MS,
  BridgeMessageType,
  createEnvelope,
  createSessionSecret,
  isCurrentTimestamp,
  isEventMessage,
  isHandshakeRequest,
  isSignedEnvelope,
  makeFailure,
  signEnvelope,
  type BridgeCommandMessage,
  type BridgeHandshakeResponse,
  type BridgeOperation,
  type BridgePayload,
  type BridgeResponse,
  verifyEnvelope,
} from './protocol';

interface BridgeSession {
  sessionId: string;
  secret: string;
  tabId: number;
  frameId: number;
  senderUrl: string;
  seenMessageIds: Map<string, number>;
}

export interface BridgeSessionManagerDependencies {
  runtimeId: string;
  sendToTab?: (tabId: number, message: BridgeCommandMessage, options: { frameId: number }) => Promise<unknown>;
  now?: () => number;
}

/**
 * Background-side bridge authority. Its sessions intentionally live only in the
 * service worker: browser runtime messaging authenticates extension contexts,
 * while per-frame HMAC keys authenticate the content/worker message body.
 */
export class BridgeSessionManager {
  private readonly sessions = new Map<string, BridgeSession>();
  private readonly now: () => number;
  private readonly sendToTab?: BridgeSessionManagerDependencies['sendToTab'];

  public constructor(private readonly dependencies: BridgeSessionManagerDependencies) {
    this.now = dependencies.now ?? Date.now;
    this.sendToTab = dependencies.sendToTab;
  }

  public async handleMessage(message: unknown, sender: chrome.runtime.MessageSender): Promise<BridgeResponse | null> {
    if (sender.id !== this.dependencies.runtimeId) return null;
    if (isHandshakeRequest(message)) return this.createSession(sender);
    if (isEventMessage(message)) return this.acceptEvent(message.envelope, sender);
    return null;
  }

  public async sendCommand(
    sessionId: string,
    operation: Exclude<BridgeOperation, 'bridge.ready'>,
    payload: BridgePayload,
  ): Promise<BridgeResponse> {
    const session = this.sessions.get(sessionId);
    if (!session || !this.sendToTab) return makeFailure('invalid-session');

    const envelope = await signEnvelope(
      createEnvelope(sessionId, 'worker-to-content', operation, payload, this.now()),
      session.secret,
    );
    const message: BridgeCommandMessage = { type: BridgeMessageType.command, envelope };

    try {
      const response = await this.sendToTab(session.tabId, message, { frameId: session.frameId });
      return this.verifyCommandResult(response, session, operation);
    } catch {
      return makeFailure('operation-failed');
    }
  }

  public sessionCount(): number {
    return this.sessions.size;
  }

  private createSession(sender: chrome.runtime.MessageSender): BridgeResponse {
    const frame = getArenaFrame(sender);
    if (!frame) return makeFailure('invalid-message');

    const sessionId = createSessionId();
    const session: BridgeSession = {
      sessionId,
      secret: createSessionSecret(),
      tabId: frame.tabId,
      frameId: frame.frameId,
      senderUrl: frame.url,
      seenMessageIds: new Map(),
    };
    this.sessions.set(sessionId, session);

    const response: BridgeHandshakeResponse = {
      ok: true,
      protocol: 1,
      sessionId,
      secret: session.secret,
    };
    return response;
  }

  private async acceptEvent(envelope: Parameters<typeof verifyEnvelope>[0], sender: chrome.runtime.MessageSender): Promise<BridgeResponse> {
    const session = this.sessions.get(envelope.sessionId);
    if (!session || !senderMatchesSession(sender, session)) return makeFailure('invalid-session');
    if (envelope.direction !== 'content-to-worker') return makeFailure('invalid-message');
    if (!isCurrentTimestamp(envelope.timestamp, this.now())) return makeFailure('expired-message');
    if (session.seenMessageIds.has(envelope.messageId)) return makeFailure('replayed-message');
    if (!await verifyEnvelope(envelope, session.secret)) return makeFailure('invalid-signature');

    session.seenMessageIds.set(envelope.messageId, envelope.timestamp);
    this.pruneReplayCache(session);
    return { ok: true };
  }

  private async verifyCommandResult(response: unknown, session: BridgeSession, operation: BridgeOperation): Promise<BridgeResponse> {
    if (!isRecord(response) || response.ok !== true || !isSignedEnvelope(response.envelope)) {
      return makeFailure('invalid-message');
    }

    const { envelope } = response;
    if (envelope.sessionId !== session.sessionId || envelope.direction !== 'content-to-worker' || envelope.operation !== operation) {
      return makeFailure('invalid-session');
    }
    if (!isCurrentTimestamp(envelope.timestamp, this.now())) return makeFailure('expired-message');
    if (session.seenMessageIds.has(envelope.messageId)) return makeFailure('replayed-message');
    if (!await verifyEnvelope(envelope, session.secret)) return makeFailure('invalid-signature');

    session.seenMessageIds.set(envelope.messageId, envelope.timestamp);
    this.pruneReplayCache(session);
    return { ok: true, envelope };
  }

  private pruneReplayCache(session: BridgeSession): void {
    const threshold = this.now() - BRIDGE_MAX_AGE_MS;
    for (const [messageId, timestamp] of session.seenMessageIds) {
      if (timestamp < threshold) session.seenMessageIds.delete(messageId);
    }
  }
}

function getArenaFrame(sender: chrome.runtime.MessageSender): { tabId: number; frameId: number; url: string } | null {
  const tabId = sender.tab?.id;
  const frameId = sender.frameId ?? 0;
  const url = sender.url;
  if (!Number.isInteger(tabId) || typeof url !== 'string' || !isArenaUrl(url)) return null;
  return { tabId: tabId as number, frameId, url };
}

function senderMatchesSession(sender: chrome.runtime.MessageSender, session: BridgeSession): boolean {
  return sender.tab?.id === session.tabId
    && (sender.frameId ?? 0) === session.frameId
    && sender.url === session.senderUrl;
}

function isArenaUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && (parsed.hostname === 'arena.ai' || parsed.hostname.endsWith('.arena.ai'));
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createSessionId(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
