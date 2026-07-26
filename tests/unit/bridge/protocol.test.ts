import {
  BridgeMessageType,
  createEnvelope,
  createSessionSecret,
  isCommandMessage,
  isHandshakeRequest,
  isSignedEnvelope,
  signEnvelope,
  verifyEnvelope,
} from '../../../src/bridge/protocol';
import { installWebCrypto } from '../../support/webcrypto';

beforeAll(installWebCrypto);

const sessionId = 'MDEyMzQ1Njc4OWFiY2RlZmdoaWprbG1ub3A';

describe('bridge protocol', () => {
  it('signs a canonical envelope and detects payload tampering', async () => {
    const secret = createSessionSecret();
    const unsigned = createEnvelope(sessionId, 'content-to-worker', 'page.snapshot', {}, 1_000);
    const signed = await signEnvelope(unsigned, secret);

    expect(await verifyEnvelope(signed, secret)).toBe(true);
    expect(await verifyEnvelope({ ...signed, timestamp: 1_001 }, secret)).toBe(false);
    expect(await verifyEnvelope(signed, createSessionSecret())).toBe(false);
  });

  it('rejects unknown keys, malformed payloads, and protocol confusion', async () => {
    const secret = createSessionSecret();
    const signed = await signEnvelope(
      createEnvelope(sessionId, 'worker-to-content', 'overlay.setStatus', { message: 'Ready', level: 'info' }),
      secret,
    );

    expect(isSignedEnvelope(signed)).toBe(true);
    expect(isSignedEnvelope({ ...signed, injected: true })).toBe(false);
    expect(isCommandMessage({ type: BridgeMessageType.command, envelope: signed })).toBe(true);
    expect(isCommandMessage({ type: BridgeMessageType.command, envelope: { ...signed, payload: { selector: 'body' } } })).toBe(false);
    expect(isHandshakeRequest({ type: BridgeMessageType.handshake, protocol: 1 })).toBe(true);
    expect(isHandshakeRequest({ type: BridgeMessageType.handshake, protocol: 2 })).toBe(false);
  });
});
