import fs from 'node:fs';
import path from 'node:path';

const SOURCE_ROOT = path.join(process.cwd(), 'src');

function listTypeScriptFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listTypeScriptFiles(entryPath) : entry.name.endsWith('.ts') ? [entryPath] : [];
  });
}

describe('centralized browser primitives', () => {
  it('keeps repeating timers inside TickDispatcher', () => {
    const violations = listTypeScriptFiles(SOURCE_ROOT)
      .filter((file) => file !== path.join(SOURCE_ROOT, 'core', 'tick-dispatcher.ts'))
      .filter((file) => /(?:globalThis\.)?setInterval\s*\(/u.test(fs.readFileSync(file, 'utf8')));

    expect(violations).toEqual([]);
  });

  it('keeps raw MutationObserver construction inside DOMObserver v2', () => {
    const violations = listTypeScriptFiles(SOURCE_ROOT)
      .filter((file) => file !== path.join(SOURCE_ROOT, 'observability', 'dom-observer.ts'))
      .filter((file) => /new\s+MutationObserver\s*\(/u.test(fs.readFileSync(file, 'utf8')));

    expect(violations).toEqual([]);
  });
});
