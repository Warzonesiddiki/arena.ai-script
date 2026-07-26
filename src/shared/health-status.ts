interface HealthResponse {
  ok: true;
  version: string;
  platform: 'manifest-v3';
}

function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== 'object' || value === null) return false;
  const response = value as Partial<HealthResponse>;
  return response.ok === true
    && typeof response.version === 'string'
    && response.platform === 'manifest-v3';
}

/** Updates a page status element without allowing a service response to become HTML. */
export async function updateHealthStatus(elementId: string): Promise<void> {
  const status = document.getElementById(elementId);
  if (!status) return;

  try {
    const response: unknown = await chrome.runtime.sendMessage({ type: 'aamp:health-check' });
    if (!isHealthResponse(response)) throw new Error('Invalid health-check response.');

    status.textContent = `Service worker ready · v${response.version}`;
    status.dataset.state = 'ready';
  } catch (error) {
    console.warn('[AAMP] Extension service health check failed.', error);
    status.textContent = 'Extension service is unavailable. Reload the extension and try again.';
    status.dataset.state = 'error';
  }
}
