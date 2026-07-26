# ⚡ Arena Agent Mode Pro

> **v8.0.0 — Chrome Extension Foundation**
>
> A Manifest V3 Chrome extension for transparent, safety-first assistance in [Arena.ai](https://arena.ai) Agent Mode.

Arena Agent Mode Pro is moving from a Tampermonkey userscript to a Chrome extension so it can offer durable background infrastructure, native browser surfaces, stronger safety boundaries, and—only after the foundation is complete—carefully governed multi-agent workflows.

## Current implementation status

**Phase 0A — Extension Foundation is complete.** The repository now builds an unpacked Manifest V3 extension with:

- TypeScript + webpack 5 build pipeline
- An ES-module service worker
- Native Side Panel, popup, and options-page entry points
- Narrow Arena.ai host permissions (`arena.ai` and its subdomains only)
- A deliberately inert content-script entry point, reserved for the validated Content Bridge in Phase 0C
- Build-artifact manifest validation before an extension is loaded in Chrome

The legacy v7.2 userscript remains at `arena-agent-mode-pro.user.js` while its capabilities are ported in blueprint order. The next work item is **Phase 0B: Core Utilities**; no multi-agent feature is enabled yet.

## Blueprint and project documentation

The implementation sequence and technical guardrails are documented in:

- [20-Phase Zero-Compromise Blueprint](docs/20-PHASE-BLUEPRINT.md)
- [Phase 3–6 Multi-Agent Technical Specification](docs/TECHNICAL-SPEC-PHASE-3-6.md)
- [Phase 0A Implementation Record](docs/PHASE-0A-IMPLEMENTATION.md)
- [Documentation Index](docs/BLUEPRINT-INDEX.md)

Key principles are deterministic coordination, minimum necessary context, observability before complexity, hard cost governance, and gradual rollout (a maximum of three agents in Phase 3 and five in Phase 6).

## Development

### Prerequisites

- Node.js **20.19+** (the current dependency set is tested with Node 22)
- Google Chrome **114+** for the Side Panel API

### Install and build

```bash
git clone https://github.com/Warzonesiddiki/arena.ai-script.git
cd arena.ai-script
npm install
npm run build
```

`npm run build` type-checks TypeScript, bundles every extension entry point, copies extension assets, and verifies that every manifest reference exists in `dist/`.

### Load the development extension

1. Run `npm run build`.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose this repository’s `dist/` directory.
5. Open an `https://arena.ai/` page and use the extension toolbar action / Side Panel.

For development rebuilds:

```bash
npm run watch
```

Reload the unpacked extension in `chrome://extensions` after webpack emits a new build.

## Testing

```bash
npm test
```

The current suite runs:

1. The extension type-check, production build, and Manifest V3 artifact validation.
2. The retained v7.2 userscript syntax, smoke, and regression checks.

Jest and Chrome-extension test utilities are scheduled for **Phase 0E**; the artifact validator is the Phase 0A guard against missing/incorrect generated files.

## Repository layout

```text
extension/public/       Static extension assets copied unchanged to dist/
  manifest.json         Manifest V3 declaration and least-privilege permissions
  popup/                Popup HTML
  sidepanel/            Native Side Panel HTML
  options/              Options-page HTML
src/
  background/           Manifest V3 service worker entry
  content/              Reserved Content Bridge entry (Phase 0C)
  popup/                Popup behavior
  sidepanel/            Side Panel behavior
  options/              Options-page behavior
  shared/               Shared extension-only helpers
scripts/                Build cleanup and asset-copy steps
tests/                  Extension artifact validation + legacy regression tests
docs/                   Blueprint and implementation records
arena-agent-mode-pro.user.js  Legacy v7.2 userscript, retained during migration
```

`dist/` is generated and intentionally ignored by Git; it is the only directory that should be loaded as an unpacked extension.

## Security posture in Phase 0A

- The extension requests no blanket `<all_urls>` access.
- The content script intentionally accepts no `window.postMessage` data and performs no page DOM changes.
- The service worker stores no product state in memory; Manifest V3 workers may be suspended at any time. Phase 0D owns durable storage.
- The service worker’s only current message is an internal extension-page health check, with a validated response shape.

The schema-validated, allow-listed Content Bridge and its tests are explicitly deferred to Phase 0C rather than silently creating a page-to-extension trust channel now.

## Legacy userscript

The v7.2.0 userscript is still available for compatibility while migration proceeds. It is not the v8 runtime and should not receive new v8 capabilities. Its existing regression suite remains in CI coverage until the corresponding extension modules are ported and validated.

## License

MIT © Arena Agent Mode Pro contributors
