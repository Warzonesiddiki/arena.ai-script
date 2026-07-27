import {
  BridgeMessageType,
  createEnvelope,
  isHandshakeResponse,
  isSignedEnvelope,
  signEnvelope,
  verifyEnvelope,
  type BridgeCommandMessage,
} from '../../../src/bridge/protocol';
import { BridgeSessionManager } from '../../../src/bridge/session-manager';
import { installWebCrypto } from '../../support/webcrypto';

beforeAll(installWebCrypto);

const sender = {
  id: 'aamp-extension',
  tab: { id: 42 },
  frameId: 0,
  url: 'https://arena.ai/agent/example',
} as chrome.runtime.MessageSender;

describe('BridgeSessionManager', () => {
  it('binds a session to its Arena frame and rejects replayed or foreign events', async () => {
    const manager = new BridgeSessionManager({ runtimeId: 'aamp-extension', now: () => 10_000 });
    const handshake = await manager.handleMessage({ type: BridgeMessageType.handshake, protocol: 1 }, sender);
    expect(isHandshakeResponse(handshake)).toBe(true);
    if (!isHandshakeResponse(handshake)) throw new Error('expected handshake');

    const envelope = await signEnvelope(
      createEnvelope(
        handshake.sessionId,
        'content-to-worker',
        'bridge.ready',
        { snapshot: { title: 'Arena Agent', path: '/agent/example', isAgentMode: true } },
        10_000,
      ),
      handshake.secret,
    );

    expect(await manager.handleMessage({ type: BridgeMessageType.event, envelope }, sender)).toEqual({ ok: true });
    expect(await manager.handleMessage({ type: BridgeMessageType.event, envelope }, sender)).toEqual({ ok: false, code: 'replayed-message' });
    expect(await manager.handleMessage({ type: BridgeMessageType.event, envelope }, { ...sender, tab: { id: 99 } } as chrome.runtime.MessageSender))
      .toEqual({ ok: false, code: 'invalid-session' });
  });

  it('does not establish a session for a non-Arena sender', async () => {
    const manager = new BridgeSessionManager({ runtimeId: 'aamp-extension' });
    const response = await manager.handleMessage(
      { type: BridgeMessageType.handshake, protocol: 1 },
      { ...sender, url: 'https://example.com/' } as chrome.runtime.MessageSender,
    );

    expect(response).toEqual({ ok: false, code: 'invalid-message' });
    expect(manager.sessionCount()).toBe(0);
  });

  it('signs worker commands for only the bound frame', async () => {
    const sendToTab = jest.fn<Promise<unknown>, [number, BridgeCommandMessage, { frameId: number }]>();
    const manager = new BridgeSessionManager({ runtimeId: 'aamp-extension', sendToTab, now: () => 10_000 });
    const handshake = await manager.handleMessage({ type: BridgeMessageType.handshake, protocol: 1 }, sender);
    if (!isHandshakeResponse(handshake)) throw new Error('expected handshake');
    sendToTab.mockImplementation(async (_tabId, command) => ({
      ok: true,
      envelope: await signEnvelope(
        createEnvelope(command.envelope.sessionId, 'content-to-worker', 'page.snapshot', { ok: true, result: {} }, 10_000),
        handshake.secret,
      ),
    }));

    await expect(manager.sendCommand(handshake.sessionId, 'page.snapshot', {})).resolves.toEqual(expect.objectContaining({ ok: true }));
    expect(sendToTab).toHaveBeenCalledWith(42, expect.any(Object), { frameId: 0 });

    const command = sendToTab.mock.calls[0]?.[1];
    expect(command?.type).toBe(BridgeMessageType.command);
    expect(isSignedEnvelope(command?.envelope)).toBe(true);
    if (!command || !isSignedEnvelope(command.envelope)) throw new Error('expected signed command');
    expect(command.envelope.direction).toBe('worker-to-content');
    expect(await verifyEnvelope(command.envelope, handshake.secret)).toBe(true);
  });

  it('rejects an unsigned command result instead of trusting the tab response', async () => {
    const sendToTab = jest.fn<Promise<unknown>, [number, BridgeCommandMessage, { frameId: number }]>().mockResolvedValue({ ok: true });
    const manager = new BridgeSessionManager({ runtimeId: 'aamp-extension', sendToTab, now: () => 10_000 });
    const handshake = await manager.handleMessage({ type: BridgeMessageType.handshake, protocol: 1 }, sender);
    if (!isHandshakeResponse(handshake)) throw new Error('expected handshake');

    await expect(manager.sendCommand(handshake.sessionId, 'overlay.removeStatus', {}))
      .resolves.toEqual({ ok: false, code: 'invalid-message' });
  });
  it('ignores traffic from any extension id other than its own', async () => {
    const manager = new BridgeSessionManager({ runtimeId: 'aamp-extension', now: () => 10_000 });

    // A different extension must not be able to open a session at all.
    await expect(manager.handleMessage(
      { type: BridgeMessageType.handshake, protocol: 1 },
      { ...sender, id: 'some-other-extension' } as chrome.runtime.MessageSender,
    )).resolves.toBeNull();
    expect(manager.sessionCount()).toBe(0);
  });

  it('returns null for message shapes it does not recognise', async () => {
    const manager = new BridgeSessionManager({ runtimeId: 'aamp-extension', now: () => 10_000 });

    await expect(manager.handleMessage({ type: 'aamp:unknown' }, sender)).resolves.toBeNull();
    await expect(manager.handleMessage(null, sender)).resolves.toBeNull();
    await expect(manager.handleMessage({ type: BridgeMessageType.event }, sender)).resolves.toBeNull();
  });

  it('rejects an expired envelope even when its signature is valid', async () => {
    let clock = 10_000;
    const manager = new BridgeSessionManager({ runtimeId: 'aamp-extension', now: () => clock });
    const handshake = await manager.handleMessage({ type: BridgeMessageType.handshake, protocol: 1 }, sender);
    if (!isHandshakeResponse(handshake)) throw new Error('expected handshake');

    const envelope = await signEnvelope(
      createEnvelope(handshake.sessionId, 'content-to-worker', 'page.snapshot', {}, clock),
      handshake.secret,
    );

    // A correctly signed message is still refused once it is stale.
    clock += 10 * 60 * 1_000;
    await expect(manager.handleMessage({ type: BridgeMessageType.event, envelope }, sender))
      .resolves.toEqual(expect.objectContaining({ ok: false, code: 'expired-message' }));
  });

  it('rejects an envelope whose session id does not exist', async () => {
    const manager = new BridgeSessionManager({ runtimeId: 'aamp-extension', now: () => 10_000 });
    const handshake = await manager.handleMessage({ type: BridgeMessageType.handshake, protocol: 1 }, sender);
    if (!isHandshakeResponse(handshake)) throw new Error('expected handshake');

    const envelope = await signEnvelope(
      createEnvelope('A'.repeat(24), 'content-to-worker', 'page.snapshot', {}, 10_000),
      handshake.secret,
    );

    await expect(manager.handleMessage({ type: BridgeMessageType.event, envelope }, sender))
      .resolves.toEqual(expect.objectContaining({ ok: false }));
  });

  it('refuses to send a command for an unknown session', async () => {
    const manager = new BridgeSessionManager({ runtimeId: 'aamp-extension', now: () => 10_000 });

    await expect(manager.sendCommand('A'.repeat(24), 'page.snapshot', {}))
      .resolves.toEqual(expect.objectContaining({ ok: false }));
  });

  it('fails closed when the content script throws instead of responding', async () => {
    const manager = new BridgeSessionManager({
      runtimeId: 'aamp-extension',
      now: () => 10_000,
      sendToTab: async () => { throw new Error('tab is gone'); },
    });
    const handshake = await manager.handleMessage({ type: BridgeMessageType.handshake, protocol: 1 }, sender);
    if (!isHandshakeResponse(handshake)) throw new Error('expected handshake');

    // A dead tab must produce a failure, never an unhandled rejection.
    await expect(manager.sendCommand(handshake.sessionId, 'page.snapshot', {}))
      .resolves.toEqual(expect.objectContaining({ ok: false, code: 'operation-failed' }));
  });

  it('rejects a command result signed for a different operation', async () => {
    let secret = '';
    const manager = new BridgeSessionManager({
      runtimeId: 'aamp-extension',
      now: () => 10_000,
      sendToTab: async (_tabId, message) => {
        const command = message as BridgeCommandMessage;
        // Answer a page.snapshot request with a result for a different operation.
        const envelope = await signEnvelope(
          createEnvelope(command.envelope.sessionId, 'content-to-worker', 'overlay.removeStatus', {}, 10_000),
          secret,
        );
        return { ok: true, envelope };
      },
    });
    const handshake = await manager.handleMessage({ type: BridgeMessageType.handshake, protocol: 1 }, sender);
    if (!isHandshakeResponse(handshake)) throw new Error('expected handshake');
    secret = handshake.secret;

    await expect(manager.sendCommand(handshake.sessionId, 'page.snapshot', {}))
      .resolves.toEqual(expect.objectContaining({ ok: false, code: 'invalid-session' }));
  });

  it('rejects a non-https or non-Arena origin', async () => {
    const manager = new BridgeSessionManager({ runtimeId: 'aamp-extension', now: () => 10_000 });

    for (const url of ['http://arena.ai/x', 'https://arena.ai.evil.com/x', 'https://notarena.ai/x', 'not-a-url']) {
      await expect(manager.handleMessage(
        { type: BridgeMessageType.handshake, protocol: 1 },
        { ...sender, url } as chrome.runtime.MessageSender,
      )).resolves.toEqual(expect.objectContaining({ ok: false }));
    }
    // A legitimate Arena subdomain is still accepted.
    await expect(manager.handleMessage(
      { type: BridgeMessageType.handshake, protocol: 1 },
      { ...sender, url: 'https://app.arena.ai/agent' } as chrome.runtime.MessageSender,
    )).resolves.toEqual(expect.objectContaining({ ok: true }));
  });
});
