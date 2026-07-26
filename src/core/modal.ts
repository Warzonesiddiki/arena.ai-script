export interface ModalOptions {
  className?: string;
  style?: string;
  width?: string;
  footer?: string;
  closeOnBackdrop?: boolean;
  document?: Document;
}

/**
 * Shared modal template ported from v7.2.
 *
 * `bodyHTML` and `footer` are reserved for extension-owned template strings.
 * Never pass Arena/page-derived data into them; use DOM nodes and `textContent`
 * at the call site for untrusted text.
 */
export function buildModal(id: string, title: string, bodyHTML: string, options: ModalOptions = {}): HTMLElement {
  const documentRef = options.document ?? document;
  const existing = documentRef.getElementById(id);
  existing?.remove();

  if (!documentRef.body) throw new Error('buildModal requires a document body.');

  const modal = documentRef.createElement('div');
  modal.id = id;
  modal.className = options.className ?? '';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.style.cssText = options.style
    ?? 'position:fixed;inset:0;z-index:999995;display:flex;align-items:center;justify-content:center;font-family:var(--aamp-font);';

  const backdrop = documentRef.createElement('div');
  backdrop.className = 'aamp-modal-backdrop';
  backdrop.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);';

  const panel = documentRef.createElement('div');
  panel.className = 'aamp-modal-panel';
  panel.style.cssText = [
    'position:relative',
    'background:var(--aamp-surface)',
    'border:1px solid var(--aamp-border)',
    'border-radius:16px',
    'box-shadow:var(--aamp-shadow),var(--aamp-glow)',
    'max-width:90vw',
    'max-height:85vh',
    `width:${options.width ?? '640px'}`,
    'overflow:hidden',
    'display:flex',
    'flex-direction:column',
  ].join(';');

  const header = documentRef.createElement('div');
  header.className = 'aamp-modal-header';
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:14px 20px;background:var(--aamp-surface2);border-bottom:1px solid var(--aamp-border);flex-shrink:0;';

  const heading = documentRef.createElement('span');
  heading.style.cssText = 'font-size:16px;font-weight:700;color:var(--aamp-text);';
  heading.textContent = title;

  const closeButton = documentRef.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'aamp-modal-close';
  closeButton.setAttribute('aria-label', 'Close dialog');
  closeButton.style.cssText = 'background:none;border:none;color:var(--aamp-text2);cursor:pointer;font-size:18px;';
  closeButton.textContent = '✕';

  const body = documentRef.createElement('div');
  body.className = 'aamp-modal-body';
  body.style.cssText = 'flex:1;overflow-y:auto;padding:20px;';
  body.innerHTML = bodyHTML;

  header.append(heading, closeButton);
  panel.append(header, body);

  if (options.footer !== undefined) {
    const footer = documentRef.createElement('div');
    footer.className = 'aamp-modal-footer';
    footer.style.cssText = 'padding:12px 20px;border-top:1px solid var(--aamp-border);background:var(--aamp-surface2);flex-shrink:0;';
    footer.innerHTML = options.footer;
    panel.append(footer);
  }

  modal.append(backdrop, panel);
  documentRef.body.append(modal);

  const close = (): void => modal.remove();
  if (options.closeOnBackdrop ?? true) backdrop.addEventListener('click', close);
  closeButton.addEventListener('click', close);

  return modal;
}
