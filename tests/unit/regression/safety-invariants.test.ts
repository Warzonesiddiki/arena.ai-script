import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Cross-cutting safety invariants.
 *
 * These assert the product principles against the whole `src/` tree rather than
 * one module, so a future phase cannot quietly reintroduce an unsafe capability
 * in a file nobody thought to re-review.
 */

const SRC = path.join(__dirname, '../../../src');

function sourceFiles(directory = SRC): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.isFile() && entry.name.endsWith('.ts') ? [full] : [];
  });
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
}

const files = sourceFiles();
const code = new Map(files.map((file) => [path.relative(SRC, file), stripComments(fs.readFileSync(file, 'utf8'))]));

describe('cross-cutting safety invariants', () => {
  it('covers a non-trivial source tree', () => {
    expect(files.length).toBeGreaterThan(25);
  });

  it('performs no network egress anywhere in src/', () => {
    for (const [file, source] of code) {
      expect({ file, hit: /\bfetch\s*\(/u.test(source) }).toEqual({ file, hit: false });
      expect({ file, hit: /\bXMLHttpRequest\b/u.test(source) }).toEqual({ file, hit: false });
      expect({ file, hit: /\bWebSocket\b/u.test(source) }).toEqual({ file, hit: false });
      expect({ file, hit: /\bsendBeacon\b/u.test(source) }).toEqual({ file, hit: false });
    }
  });

  it('never launches tabs, navigates, or opens windows', () => {
    for (const [file, source] of code) {
      expect({ file, hit: /chrome\.tabs\.(create|update|remove)\b/u.test(source) }).toEqual({ file, hit: false });
      expect({ file, hit: /chrome\.windows\.create\b/u.test(source) }).toEqual({ file, hit: false });
      expect({ file, hit: /\bwindow\.open\s*\(/u.test(source) }).toEqual({ file, hit: false });
      expect({ file, hit: /location\s*\.\s*(href|assign|replace)\s*=/u.test(source) }).toEqual({ file, hit: false });
    }
  });

  it('never evaluates dynamic code', () => {
    for (const [file, source] of code) {
      expect({ file, hit: /\beval\s*\(/u.test(source) }).toEqual({ file, hit: false });
      expect({ file, hit: /new\s+Function\s*\(/u.test(source) }).toEqual({ file, hit: false });
      expect({ file, hit: /\binnerHTML\s*=/u.test(source) }).toEqual({ file, hit: false });
      expect({ file, hit: /\bdocument\.write\b/u.test(source) }).toEqual({ file, hit: false });
    }
  });

  it('exposes no page-facing postMessage command channel', () => {
    for (const [file, source] of code) {
      expect({ file, hit: /window\.postMessage\s*\(/u.test(source) }).toEqual({ file, hit: false });
      // Listening for page messages would create an inbound trust channel.
      expect({ file, hit: /addEventListener\s*\(\s*['"]message['"]/u.test(source) }).toEqual({ file, hit: false });
    }
  });

  it('requests no browser permission beyond the implemented, tested set', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../extension/public/manifest.json'), 'utf8'));
    expect(manifest.permissions).toEqual(['alarms', 'notifications', 'sidePanel', 'storage']);
    expect(manifest.host_permissions).toEqual(['https://arena.ai/*', 'https://*.arena.ai/*']);
    expect(manifest.permissions).not.toContain('<all_urls>');

    // Every chrome.* namespace used in src/ must be covered by a permission,
    // the manifest surface, or an always-available API.
    const allowed = new Set(['alarms', 'notifications', 'sidePanel', 'storage', 'runtime', 'tabs']);
    for (const [file, source] of code) {
      for (const match of source.matchAll(/chrome\.([a-zA-Z]+)\b/gu)) {
        expect({ file, api: match[1], allowed: allowed.has(match[1]!) }).toEqual({ file, api: match[1], allowed: true });
      }
    }
  });

  it('keeps every approval gate a literal true check rather than a truthy check', () => {
    // A truthy check would let `approvedByHuman: 'no'` pass.
    for (const [file, source] of code) {
      for (const match of source.matchAll(/if\s*\(\s*(?:!)?(\w*[aA]pprovedByHuman)\s*\)/gu)) {
        throw new Error(`${file} uses a truthy approval check on "${match[1]}"; require an explicit === true comparison.`);
      }
    }
    // The gates that do exist compare strictly.
    const gated = [...code.values()].filter((source) => source.includes('approvedByHuman'));
    expect(gated.length).toBeGreaterThan(3);
    for (const source of gated) {
      expect(source).toMatch(/approvedByHuman\s*!==\s*true|approvedByHuman\s*===\s*true|approvedByHuman:\s*true/u);
    }
  });

  it('keeps the Phase 3 capability tier as the default so capability stays opt-in', () => {
    const tier = code.get(path.join('orchestration', 'capability-tier.ts'));
    expect(tier).toBeDefined();
    expect(tier).toMatch(/DEFAULT_CAPABILITY_TIER:\s*CapabilityTier\s*=\s*'phase3'/u);
  });

  it('never persists a raw credential field', () => {
    for (const [file, source] of code) {
      expect({ file, hit: /putLarge\([^)]*\b(apiKey|secret|token|password)\b/u.test(source) }).toEqual({ file, hit: false });
    }
  });
});
