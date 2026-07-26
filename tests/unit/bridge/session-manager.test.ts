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
});
