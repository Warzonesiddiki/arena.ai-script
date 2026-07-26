/**
 * The only protocol shared by the MV3 worker and the isolated content script.
 * Page JavaScript never receives a bridge key or an extension runtime handle.
 */
export const BRIDGE_PROTOCOL_VERSION = 1 as const;
export const BRIDGE_MAX_AGE_MS = 2 * 60_000;
export const BRIDGE_MAX_FUTURE_SKEW_MS = 15_000;

export const BridgeMessageType = {
  handshake: 'aamp:bridge:handshake',
  event: 'aamp:bridge:event',
  command: 'aamp:bridge:command',
} as const;

export type BridgeDirection = 'content-to-worker' | 'worker-to-content';
export type BridgeOperation = 'bridge.ready' | 'page.snapshot' | 'overlay.setStatus' | 'overlay.removeStatus';
export type BridgeLevel = 'info' | 'warning' | 'error';

export interface PageSnapshot {
  title: string;
  path: string;
  isAgentMode: boolean;
}

export type BridgePayload =
  | { snapshot: PageSnapshot }
  | { message: string; level: BridgeLevel }
  | Record<string, never>
  | { ok: true; result: PageSnapshot | Record<string, never> }
  | { ok: false; code: BridgeErrorCode };

export interface UnsignedBridgeEnvelope {
  protocol: typeof BRIDGE_PROTOCOL_VERSION;
  sessionId: string;
  messageId: string;
  timestamp: number;
  direction: BridgeDirection;
  operation: BridgeOperation;
  payload: BridgePayload;
}

export interface SignedBridgeEnvelope extends UnsignedBridgeEnvelope {
  signature: string;
}

export interface BridgeHandshakeRequest {
  type: typeof BridgeMessageType.handshake;
  protocol: typeof BRIDGE_PROTOCOL_VERSION;
}

export interface BridgeHandshakeResponse {
  ok: true;
  protocol: typeof BRIDGE_PROTOCOL_VERSION;
  sessionId: string;
  secret: string;
}

export interface BridgeEventMessage {
  type: typeof BridgeMessageType.event;
  envelope: SignedBridgeEnvelope;
}

export interface BridgeCommandMessage {
  type: typeof BridgeMessageType.command;
  envelope: SignedBridgeEnvelope;
}

export type BridgeErrorCode =
  | 'invalid-message'
  | 'invalid-session'
  | 'invalid-signature'
  | 'expired-message'
  | 'replayed-message'
  | 'unsupported-operation'
  | 'operation-failed';

export interface BridgeFailure {
  ok: false;
  code: BridgeErrorCode;
}

export type BridgeResponse = BridgeHandshakeResponse | BridgeFailure | { ok: true; envelope?: SignedBridgeEnvelope };

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{22,128}$/u;
const MESSAGE_ID_PATTERN = /^[A-Za-z0-9_-]{12,128}$/u;
const SIGNATURE_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/u;
const MAX_STATUS_MESSAGE_LENGTH = 500;
const MAX_TITLE_LENGTH = 256;

export function isHandshakeRequest(value: unknown): value is BridgeHandshakeRequest {
  return isRecord(value)
    && hasOnlyKeys(value, ['type', 'protocol'])
    && value.type === BridgeMessageType.handshake
    && value.protocol === BRIDGE_PROTOCOL_VERSION;
}

export function isEventMessage(value: unknown): value is BridgeEventMessage {
  return isRecord(value)
    && hasOnlyKeys(value, ['type', 'envelope'])
    && value.type === BridgeMessageType.event
    && isSignedEnvelope(value.envelope);
}

export function isCommandMessage(value: unknown): value is BridgeCommandMessage {
  return isRecord(value)
    && hasOnlyKeys(value, ['type', 'envelope'])
    && value.type === BridgeMessageType.command
    && isSignedEnvelope(value.envelope);
}

export function isHandshakeResponse(value: unknown): value is BridgeHandshakeResponse {
  return isRecord(value)
    && hasOnlyKeys(value, ['ok', 'protocol', 'sessionId', 'secret'])
    && value.ok === true
    && value.protocol === BRIDGE_PROTOCOL_VERSION
    && typeof value.sessionId === 'string'
    && SESSION_ID_PATTERN.test(value.sessionId)
    && typeof value.secret === 'string'
    && value.secret.length >= 32;
}

export function isSignedEnvelope(value: unknown): value is SignedBridgeEnvelope {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'protocol', 'sessionId', 'messageId', 'timestamp', 'direction', 'operation', 'payload', 'signature',
  ])) return false;

  const unsigned = {
    protocol: value.protocol,
    sessionId: value.sessionId,
    messageId: value.messageId,
    timestamp: value.timestamp,
    direction: value.direction,
    operation: value.operation,
    payload: value.payload,
  };
  return isUnsignedEnvelope(unsigned)
    && typeof value.signature === 'string'
    && value.signature.length >= 40
    && SIGNATURE_PATTERN.test(value.signature);
}

export function isUnsignedEnvelope(value: unknown): value is UnsignedBridgeEnvelope {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'protocol', 'sessionId', 'messageId', 'timestamp', 'direction', 'operation', 'payload',
  ])) return false;

  return value.protocol === BRIDGE_PROTOCOL_VERSION
    && typeof value.sessionId === 'string'
    && SESSION_ID_PATTERN.test(value.sessionId)
    && typeof value.messageId === 'string'
    && MESSAGE_ID_PATTERN.test(value.messageId)
    && typeof value.timestamp === 'number'
    && Number.isFinite(value.timestamp)
    && (value.direction === 'content-to-worker' || value.direction === 'worker-to-content')
    && isOperation(value.operation)
    && isPayloadForOperation(value.operation, value.payload);
}

export function isCurrentTimestamp(timestamp: number, now = Date.now()): boolean {
  return timestamp >= now - BRIDGE_MAX_AGE_MS && timestamp <= now + BRIDGE_MAX_FUTURE_SKEW_MS;
}

export function createEnvelope(
  sessionId: string,
  direction: BridgeDirection,
  operation: BridgeOperation,
  payload: BridgePayload,
  now = Date.now(),
): UnsignedBridgeEnvelope {
  return {
    protocol: BRIDGE_PROTOCOL_VERSION,
    sessionId,
    messageId: createMessageId(),
    timestamp: now,
    direction,
    operation,
    payload,
  };
}

export async function signEnvelope(envelope: UnsignedBridgeEnvelope, secret: string): Promise<SignedBridgeEnvelope> {
  if (!isUnsignedEnvelope(envelope)) throw new TypeError('Cannot sign an invalid bridge envelope.');
  return { ...envelope, signature: await signCanonicalEnvelope(envelope, secret) };
}

export async function verifyEnvelope(envelope: SignedBridgeEnvelope, secret: string): Promise<boolean> {
  if (!isSignedEnvelope(envelope)) return false;
  const expected = await signCanonicalEnvelope(stripSignature(envelope), secret);
  return constantTimeEqual(expected, envelope.signature);
}

export function createSessionSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return encodeBase64(bytes);
}

export function makeFailure(code: BridgeErrorCode): BridgeFailure {
  return { ok: false, code };
}

function isOperation(value: unknown): value is BridgeOperation {
  return value === 'bridge.ready'
    || value === 'page.snapshot'
    || value === 'overlay.setStatus'
    || value === 'overlay.removeStatus';
}

function isPayloadForOperation(operation: BridgeOperation, payload: unknown): payload is BridgePayload {
  if (!isRecord(payload)) return false;

  if (operation === 'bridge.ready') {
    return hasOnlyKeys(payload, ['snapshot']) && isSnapshot(payload.snapshot);
  }
  if (operation === 'page.snapshot') {
    return hasOnlyKeys(payload, []) || isResultPayload(payload);
  }
  if (operation === 'overlay.setStatus') {
    return (hasOnlyKeys(payload, ['message', 'level'])
      && typeof payload.message === 'string'
      && payload.message.length <= MAX_STATUS_MESSAGE_LENGTH
      && isBridgeLevel(payload.level))
      || isResultPayload(payload);
  }
  return hasOnlyKeys(payload, []) || isResultPayload(payload);
}

function isResultPayload(payload: Record<string, unknown>): boolean {
  if (payload.ok === true) {
    return hasOnlyKeys(payload, ['ok', 'result'])
      && (isSnapshot(payload.result) || (isRecord(payload.result) && hasOnlyKeys(payload.result, [])));
  }
  return hasOnlyKeys(payload, ['ok', 'code']) && payload.ok === false && isBridgeErrorCode(payload.code);
}

function isSnapshot(value: unknown): value is PageSnapshot {
  return isRecord(value)
    && hasOnlyKeys(value, ['title', 'path', 'isAgentMode'])
    && typeof value.title === 'string'
    && value.title.length <= MAX_TITLE_LENGTH
    && typeof value.path === 'string'
    && value.path.length <= 2_048
    && typeof value.isAgentMode === 'boolean';
}

function isBridgeLevel(value: unknown): value is BridgeLevel {
  return value === 'info' || value === 'warning' || value === 'error';
}

function isBridgeErrorCode(value: unknown): value is BridgeErrorCode {
  return value === 'invalid-message'
    || value === 'invalid-session'
    || value === 'invalid-signature'
    || value === 'expired-message'
    || value === 'replayed-message'
    || value === 'unsupported-operation'
    || value === 'operation-failed';
}

function stripSignature(envelope: SignedBridgeEnvelope): UnsignedBridgeEnvelope {
  const { signature: _signature, ...unsigned } = envelope;
  return unsigned;
}

async function signCanonicalEnvelope(envelope: UnsignedBridgeEnvelope, secret: string): Promise<string> {
  // A newly allocated Uint8Array guarantees an ArrayBuffer-backed key for the
  // stricter DOM typings used by current TypeScript releases.
  const rawKey = new Uint8Array(decodeBase64(secret)).buffer as ArrayBuffer;
  const key = await crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(canonicalize(envelope)));
  return encodeBase64(new Uint8Array(signature));
}

function canonicalize(envelope: UnsignedBridgeEnvelope): string {
  return JSON.stringify({
    direction: envelope.direction,
    messageId: envelope.messageId,
    operation: envelope.operation,
    payload: envelope.payload,
    protocol: envelope.protocol,
    sessionId: envelope.sessionId,
    timestamp: envelope.timestamp,
  });
}

function createMessageId(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toBase64Url(bytes: Uint8Array): string {
  return encodeBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
