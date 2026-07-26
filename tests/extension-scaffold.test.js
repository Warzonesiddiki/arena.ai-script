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
assert.deepEqual(manifest.permissions, ['notifications', 'sidePanel', 'storage'], 'Only implemented Side Panel, storage, and notification APIs may be requested.');
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

console.log('Extension scaffold validation passed.');
