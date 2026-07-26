# Phase 0A Implementation — Chrome Extension Foundation

**Status:** Complete

**Implemented:** 2026-07-26

**Blueprint reference:** [Phase 0A in the 20-Phase Blueprint](20-PHASE-BLUEPRINT.md#phase-0-genesis--extension-foundation)

## Scope delivered

Phase 0A establishes a loadable, intentionally small Manifest V3 extension. It does **not** port userscript behavior, create a page-to-extension protocol, persist product data, or introduce agents. Those responsibilities remain in later, separately testable subphases.

| Area | Delivered artifact |
|---|---|
| Manifest V3 | `extension/public/manifest.json` with a module service worker, action popup, Side Panel, options page, and Arena-only content-script declaration |
| TypeScript build | `tsconfig.json`, `webpack.config.cjs`, `ts-loader`, and reproducible npm scripts |
| Background lifecycle | `src/background/service-worker.ts` configures Side Panel action behavior and offers an internal health-check response |
| Extension surfaces | Static HTML/CSS plus TypeScript entry points for popup, Side Panel, and options pages |
| Content entry | `src/content/arena-bridge.ts`, deliberately inert until Phase 0C defines and tests its protocol |
| Build verification | `tests/extension-scaffold.test.js` checks Manifest V3 essentials and every artifact referenced by the built manifest |

## Architecture decisions

### 1. Extension source and generated output are separate

- **Authoritative source:** `src/` and `extension/public/`
- **Generated, loadable artifact:** `dist/`
- **Build command:** `npm run build`

Webpack emits one stable file per extension entry point, while the asset-copy step preserves the static manifest and HTML paths. Stable filenames make the manifest source readable and prevent a hash-renaming step from becoming a runtime failure mode. `dist/` is ignored by Git.

### 2. Least privilege at the outset

The Phase 0A manifest requests only `sidePanel`, the API used by its native control surface. `storage`, `notifications`, and `alarms` are **not** requested early; they will be added only with their respective implementations in Phases 0D, 2C, and 5B.

Host access is limited to `https://arena.ai/*` and `https://*.arena.ai/*`; no blanket `<all_urls>` permission is requested. The separate apex and wildcard patterns are required because a Chrome match pattern for `*.arena.ai` does not cover `arena.ai` itself.

The artifact validator asserts both the exact initial permission list and the exact content-script match list. Any new permission requires a documented feature need, an implementation in the same change, and a manifest-validation test update.

### 3. No accidental page-to-extension trust channel

The declared content script currently only writes a debug message. It does not read or modify Arena’s DOM, call `window.postMessage`, expose objects to the page, or relay messages to the worker. This is a safety decision, not a missing initialization step.

Phase 0C must introduce the bridge with all of the following before it is enabled:

1. Typed, allow-listed message names and payload schemas.
2. Sender and origin validation.
3. Explicit DOM read/write allow lists.
4. Message-size and rate limits.
5. Structured audit events and negative security tests.

### 4. MV3 worker lifecycle is treated as ephemeral

A Manifest V3 service worker can stop between events. The Phase 0A worker therefore has no product state in module memory and no promise of continuous execution. It only configures UI behavior and replies to a health check from extension-owned pages. Durable state, migrations, compression, and recovery belong to Phase 0D.

### 5. One safe health-check contract for extension-owned pages

The popup, Side Panel, and options page send `{ type: "aamp:health-check" }` using `chrome.runtime.sendMessage`. The worker validates this narrow request and returns a shape-checked status response. The response is written with `textContent`, never HTML. This verifies extension wiring without granting the page a communication route.

## Build and acceptance checks

```bash
npm install
npm run build
```

The build performs, in order:

1. Cleans `dist/`.
2. Strictly type-checks all TypeScript sources.
3. Bundles each entry using webpack 5.
4. Copies the manifest and static extension pages.
5. Checks Manifest V3, expected permissions, narrow host access, and every referenced generated artifact.

Manual Chrome acceptance is:

1. Load `dist/` through **chrome://extensions → Load unpacked**.
2. Confirm no manifest/load errors are shown.
3. Open the popup, Side Panel, and options page.
4. Confirm each displays `Service worker ready · v8.0.0`.

## Explicitly deferred work

| Blueprint subphase | Reason it is not part of 0A |
|---|---|
| 0B — Core Utilities | The utilities must be ported deliberately with unit tests rather than copied into the scaffold. |
| 0C — Content Bridge | A secure page boundary requires an agreed protocol and adversarial validation tests. |
| 0D — Storage Layer | No product state may be added before its local/IndexedDB ownership and recovery design is implemented. |
| 0E — Testing Foundation | Jest, browser API mocks, coverage thresholds, and CI are separate infrastructure work. |

## Next implementation step

**Phase 0B — Core Utilities:** port `ModuleRegistry`, `EventBus v2`, `TickDispatcher`, and `buildModal()` into independently tested TypeScript modules. The port should preserve user-visible behavior where relevant while correcting known lifecycle limitations for MV3.
