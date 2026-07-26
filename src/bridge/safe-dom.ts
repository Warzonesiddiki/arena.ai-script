import type { BridgeLevel, PageSnapshot } from './protocol';

export const EXTENSION_OVERLAY_ID = 'aamp-extension-status';

/** Returns a strictly bounded, allow-listed page snapshot. No conversation DOM is read. */
export function readPageSnapshot(documentRef: Document, locationRef: Location): PageSnapshot {
  const title = documentRef.title.slice(0, 256);
  const path = `${locationRef.pathname}${locationRef.search}`.slice(0, 2_048);
  return {
    title,
    path,
    isAgentMode: locationRef.pathname.includes('/agent') || documentRef.title.toLowerCase().includes('agent'),
  };
}

/** Writes only to an element owned and marked by this extension; text is never parsed as HTML. */
export function setExtensionStatus(documentRef: Document, message: string, level: BridgeLevel): void {
  const body = documentRef.body;
  if (!body) throw new Error('Cannot render extension status before document.body exists.');

  let overlay = documentRef.getElementById(EXTENSION_OVERLAY_ID);
  if (overlay && overlay.dataset.aampOwned !== 'true') {
    // Never overwrite a page-owned element that happens to use our id.
    throw new Error('Refusing to overwrite a page-owned overlay element.');
  }

  if (!overlay) {
    overlay = documentRef.createElement('div');
    overlay.id = EXTENSION_OVERLAY_ID;
    overlay.dataset.aampOwned = 'true';
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    overlay.className = 'aamp-extension-status';
    body.append(overlay);
  }

  overlay.dataset.level = level;
  overlay.textContent = message.slice(0, 500);
}

/** Removes only a node previously marked as owned by this extension. */
export function removeExtensionStatus(documentRef: Document): void {
  const overlay = documentRef.getElementById(EXTENSION_OVERLAY_ID);
  if (overlay?.dataset.aampOwned === 'true') overlay.remove();
}
