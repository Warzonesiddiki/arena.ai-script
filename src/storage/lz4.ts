/**
 * Small browser-native LZ4 block codec (no Node APIs or WebAssembly required).
 * Records carry the original byte length, so decoding never trusts an unbounded
 * output allocation from compressed data.
 */
const MIN_MATCH = 4;
const HASH_SIZE = 1 << 16;

export function compressLz4Block(input: Uint8Array): Uint8Array {
  const capacity = input.length + Math.ceil(input.length / 255) + 16;
  const output = new Uint8Array(capacity);
  const table = new Int32Array(HASH_SIZE);
  table.fill(-1);

  let inputIndex = 0;
  let anchor = 0;
  let outputIndex = 0;

  const writeByte = (value: number): void => {
    if (outputIndex >= output.length) throw new Error('LZ4 output capacity calculation failed.');
    output[outputIndex++] = value;
  };
  const writeLength = (length: number): void => {
    let remaining = length;
    while (remaining >= 255) {
      writeByte(255);
      remaining -= 255;
    }
    writeByte(remaining);
  };
  const emitSequence = (literalStart: number, literalLength: number, offset?: number, matchLength?: number): void => {
    const tokenIndex = outputIndex;
    writeByte(0);
    let token = Math.min(literalLength, 15) << 4;
    if (literalLength >= 15) writeLength(literalLength - 15);
    for (let index = 0; index < literalLength; index += 1) writeByte(input[literalStart + index] as number);

    if (offset === undefined || matchLength === undefined) {
      output[tokenIndex] = token;
      return;
    }

    writeByte(offset & 0xff);
    writeByte((offset >>> 8) & 0xff);
    const encodedMatchLength = matchLength - MIN_MATCH;
    token |= Math.min(encodedMatchLength, 15);
    if (encodedMatchLength >= 15) writeLength(encodedMatchLength - 15);
    output[tokenIndex] = token;
  };

  while (inputIndex + MIN_MATCH <= input.length) {
    const sequence = readU32(input, inputIndex);
    const hash = hashSequence(sequence);
    const reference = table[hash] as number;
    table[hash] = inputIndex;

    if (reference < 0 || inputIndex - reference > 0xffff || !matchesAt(input, reference, inputIndex, MIN_MATCH)) {
      inputIndex += 1;
      continue;
    }

    let matchLength = MIN_MATCH;
    while (inputIndex + matchLength < input.length && input[reference + matchLength] === input[inputIndex + matchLength]) {
      matchLength += 1;
    }

    emitSequence(anchor, inputIndex - anchor, inputIndex - reference, matchLength);
    inputIndex += matchLength;
    anchor = inputIndex;

    // Seed the final positions in the hash table without touching an out-of-range sequence.
    for (let position = Math.max(anchor - 2, 0); position < anchor && position + MIN_MATCH <= input.length; position += 1) {
      table[hashSequence(readU32(input, position))] = position;
    }
  }

  emitSequence(anchor, input.length - anchor);
  return output.slice(0, outputIndex);
}

export function decompressLz4Block(input: Uint8Array, originalSize: number): Uint8Array {
  if (!Number.isSafeInteger(originalSize) || originalSize < 0) throw new RangeError('Invalid LZ4 original size.');
  const output = new Uint8Array(originalSize);
  let inputIndex = 0;
  let outputIndex = 0;

  while (inputIndex < input.length) {
    const token = input[inputIndex++] as number;
    let literalLength = token >>> 4;
    if (literalLength === 15) {
      const extended = readExtendedLength(input, inputIndex);
      literalLength += extended.length;
      inputIndex = extended.nextIndex;
    }
    if (inputIndex + literalLength > input.length || outputIndex + literalLength > output.length) {
      throw new Error('Invalid LZ4 literal length.');
    }
    output.set(input.subarray(inputIndex, inputIndex + literalLength), outputIndex);
    inputIndex += literalLength;
    outputIndex += literalLength;

    // A final literal-only sequence ends the block.
    if (inputIndex === input.length) break;
    if (inputIndex + 2 > input.length) throw new Error('Invalid LZ4 offset.');
    const offset = (input[inputIndex] as number) | ((input[inputIndex + 1] as number) << 8);
    inputIndex += 2;
    if (offset === 0 || offset > outputIndex) throw new Error('Invalid LZ4 match offset.');

    let matchLength = token & 0x0f;
    if (matchLength === 15) {
      const extended = readExtendedLength(input, inputIndex);
      matchLength += extended.length;
      inputIndex = extended.nextIndex;
    }
    matchLength += MIN_MATCH;
    if (outputIndex + matchLength > output.length) throw new Error('Invalid LZ4 match length.');

    for (let index = 0; index < matchLength; index += 1) {
      output[outputIndex + index] = output[outputIndex - offset + index] as number;
    }
    outputIndex += matchLength;
  }

  if (outputIndex !== originalSize) throw new Error('LZ4 decoded size does not match record metadata.');
  return output;
}

function readU32(bytes: Uint8Array, index: number): number {
  return (bytes[index] as number)
    | ((bytes[index + 1] as number) << 8)
    | ((bytes[index + 2] as number) << 16)
    | ((bytes[index + 3] as number) << 24);
}

function hashSequence(sequence: number): number {
  return (Math.imul(sequence, 0x9e3779b1) >>> 16) & (HASH_SIZE - 1);
}

function matchesAt(bytes: Uint8Array, left: number, right: number, length: number): boolean {
  for (let index = 0; index < length; index += 1) {
    if (bytes[left + index] !== bytes[right + index]) return false;
  }
  return true;
}

function readExtendedLength(bytes: Uint8Array, startIndex: number): { length: number; nextIndex: number } {
  let length = 0;
  let index = startIndex;
  while (true) {
    if (index >= bytes.length) throw new Error('Invalid LZ4 extended length.');
    const value = bytes[index++] as number;
    length += value;
    if (value !== 255) return { length, nextIndex: index };
  }
}
