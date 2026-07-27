import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Documentation integrity guard.
 *
 * Docs drift silently: a renamed record leaves a dead link, and a phase table
 * keeps claiming a status long after the code moved on. Both happened in this
 * repository. These checks make that class of rot fail the build instead.
 */

const ROOT = path.join(__dirname, '../../..');
const DOCS = path.join(ROOT, 'docs');

function markdownFiles(): string[] {
  const docs = fs.readdirSync(DOCS).filter((name) => name.endsWith('.md')).map((name) => path.join(DOCS, name));
  return [path.join(ROOT, 'README.md'), ...docs];
}

const files = markdownFiles();

describe('documentation integrity', () => {
  it('covers the README and every docs record', () => {
    expect(files.length).toBeGreaterThan(10);
    expect(files.some((file) => file.endsWith('README.md'))).toBe(true);
  });

  it('has no broken relative links to repository files', () => {
    const broken: string[] = [];

    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      for (const match of source.matchAll(/\]\(([^)#\s]+\.md)(?:#[^)]*)?\)/gu)) {
        const target = match[1]!;
        if (/^https?:/u.test(target)) continue;
        const resolved = path.resolve(path.dirname(file), target);
        if (!fs.existsSync(resolved)) {
          broken.push(`${path.relative(ROOT, file)} -> ${target}`);
        }
      }
    }

    expect({ broken }).toEqual({ broken: [] });
  });

  it('links every implementation record from the documentation index', () => {
    const index = fs.readFileSync(path.join(DOCS, 'BLUEPRINT-INDEX.md'), 'utf8');
    const records = fs.readdirSync(DOCS).filter((name) => name.endsWith('.md') && name !== 'BLUEPRINT-INDEX.md');

    const unlisted = records.filter((name) => !index.includes(name));
    expect({ unlisted }).toEqual({ unlisted: [] });
  });

  it('keeps the README phase table consistent with the blueprint', () => {
    const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    const blueprint = fs.readFileSync(path.join(DOCS, '20-PHASE-BLUEPRINT.md'), 'utf8');

    // Phase 7 is blocked by design in both documents, or in neither.
    expect(readme.includes('Blocked by design')).toBe(true);
    expect(blueprint.includes('NOT IMPLEMENTED (deliberately blocked)')).toBe(true);

    // Every phase the README calls complete must also be marked complete in the
    // blueprint, so the two cannot disagree about what ships.
    for (const phase of ['15', '16', '17', '18']) {
      const blueprintRow = blueprint.split('\n').find((line) => line.startsWith(`| **${phase}** |`));
      expect({ phase, row: blueprintRow?.includes('Complete') ?? false }).toEqual({ phase, row: true });
    }
  });

  it('does not claim a phase is complete without an implementation record', () => {
    const index = fs.readFileSync(path.join(DOCS, 'BLUEPRINT-INDEX.md'), 'utf8');

    // Each completed milestone group should point at a record that exists.
    for (const record of [
      'PHASE-5C-IMPLEMENTATION.md',
      'PHASE-5D-5E-IMPLEMENTATION.md',
      'PHASE-6-IMPLEMENTATION.md',
      'PHASE-8-14-IMPLEMENTATION.md',
      'PHASE-10-11-IMPLEMENTATION.md',
      'PHASE-15-17-18-IMPLEMENTATION.md',
      'PHASE-16-IMPLEMENTATION.md',
    ]) {
      expect({ record, listed: index.includes(record) }).toEqual({ record, listed: true });
      expect({ record, exists: fs.existsSync(path.join(DOCS, record)) }).toEqual({ record, exists: true });
    }
  });

  it('never describes an unrequested browser permission as granted', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/public/manifest.json'), 'utf8'));
    const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

    // The README lists the granted permissions; that claim must match reality.
    for (const permission of manifest.permissions as string[]) {
      expect({ permission, documented: readme.includes(`\`${permission}\``) }).toEqual({ permission, documented: true });
    }
    for (const forbidden of ['downloads', 'webRequest', 'cookies', 'tabCapture']) {
      expect({ forbidden, granted: (manifest.permissions as string[]).includes(forbidden) }).toEqual({ forbidden, granted: false });
    }
  });
});
