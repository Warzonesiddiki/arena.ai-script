const TABLE = makeCrc32Table();

/** CRC-32 protects compressed-record metadata against accidental corruption. */
export function crc32(bytes: Uint8Array): number {
  let checksum = 0xffff_ffff;
  for (const byte of bytes) checksum = (checksum >>> 8) ^ (TABLE[(checksum ^ byte) & 0xff] as number);
  return (checksum ^ 0xffff_ffff) >>> 0;
}

function makeCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb8_8320 : 0);
    table[index] = value >>> 0;
  }
  return table;
}
