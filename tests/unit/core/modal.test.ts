import { buildModal } from '../../../src/core/modal';

describe('buildModal', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders a v7-compatible modal and replaces a duplicate id', () => {
    const first = buildModal('example', 'First title', '<p>First body</p>', { footer: '<button>Save</button>' });
    const second = buildModal('example', '<unsafe>', '<p>Second body</p>', { width: '500px' });

    expect(first.isConnected).toBe(false);
    expect(second.querySelector('.aamp-modal-body')?.textContent).toContain('Second body');
    expect(second.querySelector('.aamp-modal-header span')?.textContent).toBe('<unsafe>');
    expect(second.querySelector('.aamp-modal-footer')).toBeNull();
    expect(second.querySelector('.aamp-modal-panel')?.getAttribute('style')).toContain('width: 500px');
    expect(second.getAttribute('role')).toBe('dialog');
  });

  it('closes from the close control and optionally from the backdrop', () => {
    const modal = buildModal('close', 'Title', 'Body');
    (modal.querySelector('.aamp-modal-backdrop') as HTMLElement).click();
    expect(document.getElementById('close')).toBeNull();

    const fixedModal = buildModal('fixed', 'Title', 'Body', { closeOnBackdrop: false });
    (fixedModal.querySelector('.aamp-modal-backdrop') as HTMLElement).click();
    expect(document.getElementById('fixed')).toBe(fixedModal);
    (fixedModal.querySelector('.aamp-modal-close') as HTMLButtonElement).click();
    expect(document.getElementById('fixed')).toBeNull();
  });
});
