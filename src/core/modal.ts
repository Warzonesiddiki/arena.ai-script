/** Body/footer content: a DOM node, a list of nodes, or plain text. Never an HTML string. */
export type ModalContent = Node | readonly Node[] | string;

export interface ModalOptions {
  className?: string;
  style?: string;
  width?: string;
  footer?: ModalContent;
  closeOnBackdrop?: boolean;
  document?: Document;
}

/**
 * Shared modal template ported from v7.2.
 *
 * There is deliberately **no HTML-string sink here**. Body and footer content
 * are appended as DOM nodes, and a plain string is inserted via `textContent`,
 * so Arena/page-derived text can never become markup. Build structure with
 * `document.createElement` at the call site.
 */
export function buildModal(id: string, title: string, body: ModalContent, options: ModalOptions = {}): HTMLElement {
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

  const bodyElement = documentRef.createElement('div');
  bodyElement.className = 'aamp-modal-body';
  bodyElement.style.cssText = 'flex:1;overflow-y:auto;padding:20px;';
  appendContent(bodyElement, body);

  header.append(heading, closeButton);
  panel.append(header, bodyElement);

  if (options.footer !== undefined) {
    const footer = documentRef.createElement('div');
    footer.className = 'aamp-modal-footer';
    footer.style.cssText = 'padding:12px 20px;border-top:1px solid var(--aamp-border);background:var(--aamp-surface2);flex-shrink:0;';
    appendContent(footer, options.footer);
    panel.append(footer);
  }

  modal.append(backdrop, panel);
  documentRef.body.append(modal);

  const close = (): void => modal.remove();
  if (options.closeOnBackdrop ?? true) backdrop.addEventListener('click', close);
  closeButton.addEventListener('click', close);

  return modal;
}

/** Appends content safely: strings become text, never markup. */
function appendContent(target: HTMLElement, content: ModalContent): void {
  if (typeof content === 'string') {
    target.textContent = content;
    return;
  }
  target.append(...(Array.isArray(content) ? content : [content as Node]));
}
