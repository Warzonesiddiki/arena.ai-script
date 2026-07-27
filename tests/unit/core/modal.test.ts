import { buildModal } from '../../../src/core/modal';

describe('buildModal', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders a v7-compatible modal and replaces a duplicate id', () => {
    const saveButton = document.createElement('button');
    saveButton.textContent = 'Save';
    const firstBody = document.createElement('p');
    firstBody.textContent = 'First body';
    const first = buildModal('example', 'First title', firstBody, { footer: saveButton });
    const secondBody = document.createElement('p');
    secondBody.textContent = 'Second body';
    const second = buildModal('example', '<unsafe>', secondBody, { width: '500px' });

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

  it('never interprets string content as markup', () => {
    const modal = buildModal('escaped', 'Title', '<img src=x onerror=alert(1)>', { footer: '<b>footer</b>' });

    const body = modal.querySelector('.aamp-modal-body')!;
    // The payload is text, not an element.
    expect(body.querySelector('img')).toBeNull();
    expect(body.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(modal.querySelector('.aamp-modal-footer')?.querySelector('b')).toBeNull();
    expect(modal.querySelector('.aamp-modal-footer')?.textContent).toBe('<b>footer</b>');
  });

  it('accepts a list of nodes', () => {
    const one = document.createElement('span');
    one.textContent = 'one';
    const two = document.createElement('span');
    two.textContent = 'two';
    const modal = buildModal('nodes', 'Title', [one, two]);

    expect(modal.querySelectorAll('.aamp-modal-body span')).toHaveLength(2);
  });
});
