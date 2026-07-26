import {
  BridgeMessageType,
  createEnvelope,
  createSessionSecret,
  isSignedEnvelope,
  signEnvelope,
  verifyEnvelope,
  type BridgeHandshakeResponse,
} from '../../../src/bridge/protocol';
import { ContentBridge } from '../../../src/bridge/content-bridge';
import { EXTENSION_OVERLAY_ID } from '../../../src/bridge/safe-dom';
import { installWebCrypto } from '../../support/webcrypto';

beforeAll(installWebCrypto);

const session: BridgeHandshakeResponse = {
  ok: true,
  protocol: 1,
  sessionId: 'MDEyMzQ1Njc4OWFiY2RlZmdoaWprbG1ub3A',
  secret: '',
};

describe('ContentBridge', () => {
  beforeEach(() => {
    document.head.innerHTML = '<title>Arena Agent</title>';
    document.body.innerHTML = '';
    window.history.replaceState({}, '', '/agent/task');
  });

  it('executes signed allow-listed commands and returns a signed result', async () => {
    const runtime = { id: 'aamp-extension', sendMessage: jest.fn() } as unknown as Pick<typeof chrome.runtime, 'id' | 'sendMessage'>;
    const activeSession = { ...session, secret: createSessionSecret() };
    const bridge = new ContentBridge(activeSession, { document, location, runtime });
    const command = await signEnvelope(
      createEnvelope(activeSession.sessionId, 'worker-to-content', 'overlay.setStatus', { message: '<b>Safe</b>', level: 'info' }),
      activeSession.secret,
    );

    const response = await bridge.handleCommand(
      { type: BridgeMessageType.command, envelope: command },
      { id: 'aamp-extension' } as chrome.runtime.MessageSender,
    );

    expect(document.getElementById(EXTENSION_OVERLAY_ID)?.textContent).toBe('<b>Safe</b>');
    expect(response.ok).toBe(true);
    if (!response.ok || !('envelope' in response) || !isSignedEnvelope(response.envelope)) {
      throw new Error('expected signed response');
    }
    expect(await verifyEnvelope(response.envelope, activeSession.secret)).toBe(true);
  });

  it('announces a signed, bounded snapshot through extension runtime messaging', async () => {
    const sendMessage = jest.fn().mockResolvedValue({ ok: true });
    const runtime = { id: 'aamp-extension', sendMessage } as unknown as Pick<typeof chrome.runtime, 'id' | 'sendMessage'>;
    const activeSession = { ...session, secret: createSessionSecret() };
    const bridge = new ContentBridge(activeSession, { document, location, runtime });

    await expect(bridge.announceReady()).resolves.toEqual({ ok: true });
    const sentMessage = sendMessage.mock.calls[0]?.[0];
    expect(sentMessage?.type).toBe(BridgeMessageType.event);
    expect(isSignedEnvelope(sentMessage?.envelope)).toBe(true);
    if (!isSignedEnvelope(sentMessage?.envelope)) throw new Error('expected signed ready envelope');
    expect(await verifyEnvelope(sentMessage.envelope, activeSession.secret)).toBe(true);
  });

  it('returns snapshots, removes only its own status node, and signs execution failures', async () => {
    const runtime = { id: 'aamp-extension', sendMessage: jest.fn() } as unknown as Pick<typeof chrome.runtime, 'id' | 'sendMessage'>;
    const activeSession = { ...session, secret: createSessionSecret() };
    const bridge = new ContentBridge(activeSession, { document, location, runtime });
    const sender = { id: 'aamp-extension' } as chrome.runtime.MessageSender;

    const snapshotCommand = await signEnvelope(
      createEnvelope(activeSession.sessionId, 'worker-to-content', 'page.snapshot', {}),
      activeSession.secret,
    );
    const snapshotResponse = await bridge.handleCommand({ type: BridgeMessageType.command, envelope: snapshotCommand }, sender);
    expect(snapshotResponse.ok).toBe(true);

    const owned = document.createElement('div');
    owned.id = EXTENSION_OVERLAY_ID;
    owned.dataset.aampOwned = 'true';
    document.body.append(owned);
    const removeCommand = await signEnvelope(
      createEnvelope(activeSession.sessionId, 'worker-to-content', 'overlay.removeStatus', {}),
      activeSession.secret,
    );
    await bridge.handleCommand({ type: BridgeMessageType.command, envelope: removeCommand }, sender);
    expect(document.getElementById(EXTENSION_OVERLAY_ID)).toBeNull();

    const pageOwned = document.createElement('div');
    pageOwned.id = EXTENSION_OVERLAY_ID;
    document.body.append(pageOwned);
    const failingCommand = await signEnvelope(
      createEnvelope(activeSession.sessionId, 'worker-to-content', 'overlay.setStatus', { message: 'Blocked', level: 'warning' }),
      activeSession.secret,
    );
    const failureResponse = await bridge.handleCommand({ type: BridgeMessageType.command, envelope: failingCommand }, sender);
    expect(failureResponse.ok).toBe(true);
    if (!failureResponse.ok || !('envelope' in failureResponse) || !isSignedEnvelope(failureResponse.envelope)) {
      throw new Error('expected signed failure');
    }
    expect(await verifyEnvelope(failureResponse.envelope, activeSession.secret)).toBe(true);
  });

  it('rejects page/foreign and tampered commands without DOM effects', async () => {
    const runtime = { id: 'aamp-extension', sendMessage: jest.fn() } as unknown as Pick<typeof chrome.runtime, 'id' | 'sendMessage'>;
    const activeSession = { ...session, secret: createSessionSecret() };
    const bridge = new ContentBridge(activeSession, { document, location, runtime });
    const command = await signEnvelope(
      createEnvelope(activeSession.sessionId, 'worker-to-content', 'overlay.setStatus', { message: 'Safe', level: 'info' }),
      activeSession.secret,
    );

    await expect(bridge.handleCommand({ type: BridgeMessageType.command, envelope: command }, { id: 'other' } as chrome.runtime.MessageSender))
      .resolves.toEqual({ ok: false, code: 'invalid-message' });
    await expect(bridge.handleCommand(
      { type: BridgeMessageType.command, envelope: { ...command, payload: { message: 'Tampered', level: 'error' } } },
      { id: 'aamp-extension' } as chrome.runtime.MessageSender,
    )).resolves.toEqual({ ok: false, code: 'invalid-signature' });
    expect(document.getElementById(EXTENSION_OVERLAY_ID)).toBeNull();
  });
});
