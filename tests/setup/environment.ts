import { webcrypto } from 'node:crypto';
import { TextDecoder, TextEncoder } from 'node:util';
import { deserialize, serialize } from 'node:v8';

// jsdom does not consistently mirror browser crypto/text primitives used by MV3 code.
Object.defineProperties(globalThis, {
  crypto: { configurable: true, writable: true, value: webcrypto },
  TextEncoder: { configurable: true, writable: true, value: TextEncoder },
  TextDecoder: { configurable: true, writable: true, value: TextDecoder },
  structuredClone: {
    configurable: true,
    writable: true,
    value: <T>(value: T): T => deserialize(serialize(value)) as T,
  },
});
