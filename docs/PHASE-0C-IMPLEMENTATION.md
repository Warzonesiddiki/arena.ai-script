# Phase 0C Implementation — Secure Content Bridge

**Status:** Complete

**Implemented:** 2026-07-26

**Blueprint reference:** [Phase 0C in the 20-Phase Blueprint](20-PHASE-BLUEPRINT.md#phase-0-genesis--extension-foundation)

## Security boundary

Arena page JavaScript is not trusted as an extension principal. The bridge therefore exposes **no** `window.postMessage`, `CustomEvent`, injected-page script, DOM attribute command channel, arbitrary selector, arbitrary HTML, or arbitrary JavaScript capability.

The only path is:

```text
isolated content script  ← Chrome runtime messaging →  MV3 service worker
```

Chrome runtime messaging limits senders to this extension. On top of that browser boundary, Phase 0C binds a short-lived session to the extension ID, Arena HTTPS URL, tab ID, and frame ID, then signs every post-handshake body with a per-session HMAC-SHA-256 key.

## Protocol delivered

| Component | Responsibility |
|---|---|
| `src/bridge/protocol.ts` | Strict message schemas, canonical signing representation, Web Crypto HMAC signing/verification, timestamp limits, opaque IDs, and replay-safe message identifiers |
| `src/bridge/session-manager.ts` | Worker-side Arena frame/session validation, one-time handshake, replay cache, command signing, and signed command-result verification |
| `src/bridge/content-bridge.ts` | Isolated-world endpoint that validates worker commands, verifies signatures, executes only the allow list, and signs results |
| `src/bridge/safe-dom.ts` | Bounded page snapshot read and extension-owned status-node write/remove operations |
| `src/content/arena-bridge.ts` | Content-script bootstrap: handshakes through `chrome.runtime`, registers no page-facing channel, and announces a signed ready snapshot |

### Handshake

1. The isolated content script sends `{ type: "aamp:bridge:handshake", protocol: 1 }` through `chrome.runtime`.
2. The service worker accepts it only from this extension and an `https://arena.ai/*` or `https://*.arena.ai/*` frame with a concrete tab ID.
3. The worker creates a 256-bit random secret and opaque session ID, binds them to that tab/frame/URL, and returns them only through the Chrome runtime channel.
4. Subsequent envelopes contain a protocol version, session/message IDs, timestamp, direction, operation, payload, and HMAC-SHA-256 signature.
5. The worker rejects stale, future-dated, replayed, foreign-frame, malformed, or incorrectly signed envelopes. Command responses are also verified rather than merely trusted because they arrived from a tab.

Session keys remain only in isolated-content-script memory and service-worker memory. If the MV3 worker is suspended, the session is unavailable and bridge work fails closed; no page operation runs. The persistent/recovery policy is intentionally deferred to Phase 0D / Phase 1C.

## Strict operation allow list

| Operation | Direction | Permitted effect |
|---|---|---|
| `bridge.ready` | Content → worker | Sends a bounded `{ title, path, isAgentMode }` snapshot only |
| `page.snapshot` | Worker → content | Reads the same bounded snapshot; it does not read messages, artifacts, inputs, or arbitrary selectors |
| `overlay.setStatus` | Worker → content | Sets `textContent` (max 500 chars) on a single extension-owned status node |
| `overlay.removeStatus` | Worker → content | Removes that node only if it has the extension ownership marker |

The content bridge refuses to overwrite or remove a page node that happens to use the extension status element ID. Page-derived strings are never assigned through `innerHTML`.

## Validation and adversarial tests

The Jest suite tests:

- HMAC verification and tamper detection.
- Strict schemas that reject unknown fields and unsupported payloads.
- Frame binding, Arena-origin validation, replay prevention, and foreign-sender rejection.
- Signed worker command creation and rejection of unsigned tab responses.
- Safe DOM reads, HTML-safe status writes, and page-owned-node protection.
- Content-side signature, sender, and session checks.

The coverage scope now includes the core runtime, worker, and bridge modules; the enforced global floor remains 80% and the current suite exceeds it.

## Explicit non-capabilities

Phase 0C does **not** give the extension permission to automate Arena, read the full conversation, read arbitrary DOM nodes, inject scripts, or accept page-originated commands. It also does not persist bridge secrets or sessions. Those missing capabilities are intentional safety boundaries, not fallback behavior.

## Next step

**Phase 0D — Storage Layer v1:** add a separately tested hybrid storage ownership model using `chrome.storage.local`, IndexedDB, LZ4 compression, quota-aware retention, and recovery semantics. No bridge secret will be persisted as part of Phase 0D without a separate key-management decision.
