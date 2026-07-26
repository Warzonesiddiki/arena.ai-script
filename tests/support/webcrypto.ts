import { webcrypto } from 'node:crypto';
import { TextDecoder, TextEncoder } from 'node:util';

/** jsdom does not consistently expose Web Crypto/TextEncoder; the bridge uses both browser APIs. */
export function installWebCrypto(): void {
  Object.defineProperties(globalThis, {
    crypto: { configurable: true, writable: true, value: webcrypto },
    TextEncoder: { configurable: true, writable: true, value: TextEncoder },
    TextDecoder: { configurable: true, writable: true, value: TextDecoder },
  });
}
