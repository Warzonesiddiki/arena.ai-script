import { readPageSnapshot, removeExtensionStatus, setExtensionStatus, EXTENSION_OVERLAY_ID } from '../../../src/bridge/safe-dom';

describe('safe DOM bridge operations', () => {
  beforeEach(() => {
    document.head.innerHTML = '<title>Arena Agent</title>';
    document.body.innerHTML = '';
    window.history.replaceState({}, '', '/agent/task?run=1');
  });

  it('returns a bounded snapshot without reading the conversation DOM', () => {
    document.body.innerHTML = '<main><article>private conversation</article></main>';

    expect(readPageSnapshot(document, location)).toEqual({
      title: 'Arena Agent',
      path: '/agent/task?run=1',
      isAgentMode: true,
    });
  });

  it('writes text only to an extension-owned overlay and will not remove a page node', () => {
    setExtensionStatus(document, '<img src=x onerror=alert(1)>', 'warning');
    const overlay = document.getElementById(EXTENSION_OVERLAY_ID);

    expect(overlay?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(overlay?.querySelector('img')).toBeNull();
    expect(overlay?.dataset.level).toBe('warning');

    removeExtensionStatus(document);
    expect(document.getElementById(EXTENSION_OVERLAY_ID)).toBeNull();

    const pageNode = document.createElement('div');
    pageNode.id = EXTENSION_OVERLAY_ID;
    document.body.append(pageNode);
    removeExtensionStatus(document);
    expect(document.getElementById(EXTENSION_OVERLAY_ID)).toBe(pageNode);
    expect(() => setExtensionStatus(document, 'unsafe overwrite', 'error')).toThrow('Refusing to overwrite');
  });
  it('detects agent mode from the path or the title, and neither otherwise', () => {
    window.history.replaceState({}, '', '/chat/123');
    document.head.innerHTML = '<title>Arena Workspace</title>';
    expect(readPageSnapshot(document, location).isAgentMode).toBe(false);

    // Title-based detection is case-insensitive.
    document.head.innerHTML = '<title>My AGENT session</title>';
    expect(readPageSnapshot(document, location).isAgentMode).toBe(true);

    document.head.innerHTML = '<title>Arena Workspace</title>';
    window.history.replaceState({}, '', '/agent/run');
    expect(readPageSnapshot(document, location).isAgentMode).toBe(true);
  });

  it('bounds an oversized title and path rather than reading them whole', () => {
    document.head.innerHTML = `<title>${'t'.repeat(400)}</title>`;
    window.history.replaceState({}, '', `/agent/${'p'.repeat(3_000)}`);

    const snapshot = readPageSnapshot(document, location);
    expect(snapshot.title).toHaveLength(256);
    expect(snapshot.path).toHaveLength(2_048);
  });

  it('truncates an overlong status message', () => {
    setExtensionStatus(document, 'x'.repeat(900), 'info');
    expect(document.getElementById(EXTENSION_OVERLAY_ID)?.textContent).toHaveLength(500);
  });

  it('reuses its own overlay across updates instead of stacking nodes', () => {
    setExtensionStatus(document, 'first', 'info');
    setExtensionStatus(document, 'second', 'error');

    expect(document.querySelectorAll(`#${EXTENSION_OVERLAY_ID}`)).toHaveLength(1);
    const overlay = document.getElementById(EXTENSION_OVERLAY_ID);
    expect(overlay?.textContent).toBe('second');
    expect(overlay?.dataset.level).toBe('error');
    // Accessibility attributes are set once and preserved.
    expect(overlay?.getAttribute('role')).toBe('status');
    expect(overlay?.getAttribute('aria-live')).toBe('polite');
  });

  it('refuses to write before a document body exists', () => {
    const bodyless = { body: null } as unknown as Document;
    expect(() => setExtensionStatus(bodyless, 'nope', 'info')).toThrow('document.body');
  });

  it('removing a status is safe when none exists', () => {
    expect(() => removeExtensionStatus(document)).not.toThrow();
  });
});
