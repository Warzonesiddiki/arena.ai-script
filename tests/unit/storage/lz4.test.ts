import { compressLz4Block, decompressLz4Block } from '../../../src/storage/lz4';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe('LZ4 block codec', () => {
  it('round-trips empty, literal-only, repeated, and long inputs', () => {
    const cases = [
      '',
      'literal-only payload',
      'Arena Agent Mode Pro '.repeat(2_000),
      Array.from({ length: 100_000 }, (_, index) => String.fromCharCode(32 + (index * 31) % 90)).join(''),
    ];

    for (const value of cases) {
      const input = encoder.encode(value);
      const compressed = compressLz4Block(input);
      expect(decoder.decode(decompressLz4Block(compressed, input.byteLength))).toBe(value);
    }
  });

  it('meaningfully compresses repetitive records and rejects corrupted sizes', () => {
    const input = encoder.encode('repeated storage block '.repeat(10_000));
    const compressed = compressLz4Block(input);

    expect(compressed.byteLength).toBeLessThan(input.byteLength / 10);
    expect(() => decompressLz4Block(compressed, input.byteLength - 1)).toThrow();
    expect(() => decompressLz4Block(new Uint8Array([0xff]), 20)).toThrow();
  });
});
