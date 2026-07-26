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
});
