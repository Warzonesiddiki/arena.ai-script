/**
 * Phase 0A build artifact validation.
 * Chrome itself validates a manifest on load; this test catches the most common
 * errors before an unpacked build reaches the browser: schema essentials and
 * missing artifact references.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIST = path.join(__dirname, '..', 'dist');
const manifestPath = path.join(DIST, 'manifest.json');

assert.ok(fs.existsSync(manifestPath), 'Build output must include manifest.json. Run npm run build first.');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
assert.equal(manifest.manifest_version, 3, 'The extension must use Manifest V3.');
assert.match(manifest.version, /^\d+\.\d+\.\d+(?:\.\d+)?$/u, 'Manifest version must be a Chrome-compatible numeric version.');
assert.equal(manifest.background?.type, 'module', 'The background worker must be an ES module.');
assert.deepEqual(manifest.permissions, ['alarms', 'notifications', 'sidePanel', 'storage'], 'Only implemented alarms, Side Panel, storage, and notification APIs may be requested.');
assert.ok(!manifest.permissions.includes('<all_urls>'), 'The extension must not request blanket host access.');
assert.deepEqual(manifest.host_permissions, ['https://arena.ai/*', 'https://*.arena.ai/*']);
assert.deepEqual(
  manifest.content_scripts.flatMap((script) => script.matches),
  ['https://arena.ai/*', 'https://*.arena.ai/*'],
  'Content-script access must remain limited to Arena.ai.'
);

const requiredArtifacts = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  manifest.side_panel?.default_path,
  manifest.options_ui?.page,
  ...manifest.content_scripts.flatMap((script) => script.js),
];

for (const artifact of requiredArtifacts) {
  assert.equal(typeof artifact, 'string', 'Manifest artifact references must be strings.');
  assert.ok(fs.existsSync(path.join(DIST, artifact)), `Manifest artifact is missing from dist: ${artifact}`);
}

assert.ok(fs.existsSync(path.join(DIST, 'icons/aamp-128.png')), 'Native notification icon is missing from dist.');

// The built bundle must actually contain the safety-critical logic, not merely
// have it present in src/. Minification renames classes, so assert on
// distinctive string literals that survive it.
const workerBundle = fs.readFileSync(path.join(DIST, manifest.background.service_worker), 'utf8');
const requiredBehaviour = {
  'no-unreviewed-egress': 'safety policy engine rules',
  'audit-genesis': 'audit log hash chain',
  'resume-from-snapshot': 'recovery proposal steps',
  'hibernation:workflows': 'hibernation storage key',
  'audit:log:v1': 'audit storage key',
  'background:agent-control-state': 'durable control state key',
};
for (const [literal, description] of Object.entries(requiredBehaviour)) {
  assert.ok(
    workerBundle.includes(literal),
    `Service worker bundle is missing ${description} (expected literal "${literal}"). A completed module may have become unreachable.`
  );
}

// No bundle may ship an HTML-string sink or dynamic code evaluation.
for (const script of ['background/service-worker.js', 'sidepanel/sidepanel.js', 'popup/popup.js', 'options/options.js', 'content/arena-bridge.js']) {
  const source = fs.readFileSync(path.join(DIST, script), 'utf8');
  assert.ok(!source.includes('innerHTML'), `${script} must not use innerHTML.`);
  assert.ok(!/\beval\(/u.test(source), `${script} must not use eval.`);
}

console.log('Extension scaffold validation passed.');
