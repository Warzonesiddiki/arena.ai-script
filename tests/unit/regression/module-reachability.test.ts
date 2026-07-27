import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Reachability regression guard.
 *
 * A module can be fully tested and still be dead code if no extension entry
 * point imports it. This test walks the real import graph from the webpack
 * entry points and fails when a `src/` module is unreachable, so a future phase
 * cannot ship well-tested logic that never actually runs.
 */

const ROOT = path.join(__dirname, '../../..');
const SRC = path.join(ROOT, 'src');

const ENTRY_POINTS = [
  'src/background/service-worker.ts',
  'src/content/arena-bridge.ts',
  'src/popup/popup.ts',
  'src/sidepanel/sidepanel.ts',
  'src/options/options.ts',
];

/**
 * Modules that are intentionally not part of the runtime bundle.
 *
 * Each needs a reason. Anything not listed here must be reachable.
 */
const INTENTIONALLY_UNBUNDLED: Readonly<Record<string, string>> = {
  'testing/agent-behavior-harness.ts': 'Test-time simulation harness; never shipped to users.',
  'integrations/egress-policy.ts': 'Phase 7 prerequisite gate with no integration behind it yet.',
  'comparison/result-comparison.ts': 'Phase 6C scoring awaiting a comparison UI surface.',
  'core/module-registry.ts': 'Ported v7 utility retained for parity; no v8 consumer yet.',
};

function resolveImport(fromFile: string, specifier: string): string | null {
  const base = path.join(path.dirname(fromFile), specifier);
  for (const candidate of [`${base}.ts`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function reachableModules(): Set<string> {
  const seen = new Set<string>();
  const queue = ENTRY_POINTS.map((entry) => path.join(ROOT, entry));

  while (queue.length > 0) {
    const file = path.normalize(queue.pop()!);
    if (seen.has(file) || !fs.existsSync(file)) continue;
    seen.add(file);
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/from\s+['"](\.[^'"]+)['"]/gu)) {
      const resolved = resolveImport(file, match[1]!);
      if (resolved) queue.push(resolved);
    }
  }
  return seen;
}

function allModules(directory = SRC): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return allModules(full);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path.normalize(full)] : [];
  });
}

describe('module reachability', () => {
  const reachable = reachableModules();
  const modules = allModules();

  it('walks a meaningful import graph from every entry point', () => {
    expect(modules.length).toBeGreaterThan(40);
    expect(reachable.size).toBeGreaterThan(40);
    for (const entry of ENTRY_POINTS) {
      expect(fs.existsSync(path.join(ROOT, entry))).toBe(true);
    }
  });

  it('reaches every src/ module that is not explicitly exempt', () => {
    const unreachable = modules
      .filter((file) => !reachable.has(file))
      .map((file) => path.relative(SRC, file).split(path.sep).join('/'));

    const unexplained = unreachable.filter((file) => !(file in INTENTIONALLY_UNBUNDLED));
    expect({ unexplained }).toEqual({ unexplained: [] });
  });

  it('keeps the exemption list honest by rejecting stale entries', () => {
    const unreachable = new Set(modules
      .filter((file) => !reachable.has(file))
      .map((file) => path.relative(SRC, file).split(path.sep).join('/')));

    // An exemption for a module that IS reachable (or no longer exists) is stale.
    for (const [file, reason] of Object.entries(INTENTIONALLY_UNBUNDLED)) {
      expect({ file, stale: !unreachable.has(file) }).toEqual({ file, stale: false });
      expect(reason.length).toBeGreaterThan(20);
    }
  });

  it('wires the safety-critical governance modules into the worker', () => {
    const relative = (file: string): string => path.relative(SRC, file).split(path.sep).join('/');
    const reachableRelative = new Set([...reachable].map(relative));

    // These enforce product principles; they must never fall out of the bundle.
    for (const critical of [
      'safety/risk-policy-engine.ts',
      'audit/audit-log.ts',
      'background/background-agent-state.ts',
      'health/orchestration-health-monitor.ts',
      'recovery/recovery-snapshot-manager.ts',
      'hibernation/hibernation-manager.ts',
      'focus/focus-mode.ts',
      'governance/advanced-cost-controls.ts',
      'observability/trace-replay.ts',
      'timeline/timeline-scrubber.ts',
      'analytics/performance-analytics.ts',
      'simulation/strategy-simulator.ts',
      'knowledge/knowledge-pack.ts',
    ]) {
      expect({ critical, reachable: reachableRelative.has(critical) }).toEqual({ critical, reachable: true });
    }
  });
});
