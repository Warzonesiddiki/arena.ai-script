# Phase 0D Implementation — Hybrid Storage Layer v1

**Status:** Complete

**Implemented:** 2026-07-26

**Blueprint reference:** [Phase 0D in the 20-Phase Blueprint](20-PHASE-BLUEPRINT.md#phase-0-genesis--extension-foundation)

## Storage ownership model

`StorageLayer` separates small extension configuration from larger session/workflow artifacts rather than treating browser storage as one interchangeable bucket.

| Data class | Backend | Format | Purpose |
|---|---|---|---|
| Small settings and durable record index | `chrome.storage.local` | Structured-cloneable values | Cross-context configuration and lightweight discovery metadata |
| Large records | IndexedDB `records` store | LZ4 block-compressed `ArrayBuffer` + integrity metadata | Session snapshots, future traces, artifacts, and workflow state |
| Large-record metadata | IndexedDB `metadata` store and mirrored `chrome.storage.local` index | Small structured records | Recovery/reconciliation without loading compressed blobs |

The manifest now requests `storage`, because `chrome.storage.local` is used by the implementation. No other future permission was added.

## Delivered implementation

| Artifact | Responsibility |
|---|---|
| `src/storage/lz4.ts` | Browser-native LZ4 block compressor/decompressor; no Node API, native add-on, or WebAssembly dependency |
| `src/storage/checksum.ts` | CRC-32 integrity check of uncompressed bytes |
| `src/storage/storage-layer.ts` | Typed small-value API, IndexedDB persistence, LZ4 serialization, quota checks, serialized mutations, metadata index, repair, and corruption errors |
| `tests/unit/storage/` | LZ4 round trips/compression/error tests and hybrid storage tests using `fake-indexeddb` |

### Large record format

Each IndexedDB record contains:

```text
key, schemaVersion: 1, algorithm: "lz4-block-v1",
originalBytes, compressedBytes, checksum,
createdAt, updatedAt, data: ArrayBuffer
```

`getLarge()` checks the format version, performs bounded decompression using `originalBytes`, verifies CRC-32, and then parses JSON. Invalid lengths, malformed compressed blocks, checksum mismatches, and JSON decoding failures become `StorageCorruptionError`; data is never silently returned after a failed integrity check.

### Capacity and recovery controls

- The default raw-record maximum is **64 MiB**, which leaves explicit headroom above the blueprint’s 50 MiB requirement.
- `navigator.storage.estimate()` is checked before a large write when the browser exposes a quota/usage estimate.
- `StorageQuotaError` is thrown before writes that exceed the configured record limit or available estimated capacity.
- IndexedDB writes update the data and metadata stores in one transaction.
- The Chrome storage index is intentionally updated after a successful IndexedDB transaction. If that second step is interrupted, `repairIndex()` rebuilds it from IndexedDB metadata without loading record blobs.
- Mutations are serialized per `StorageLayer` instance so concurrent worker events cannot overwrite the mirrored index.

## Key management and privacy

Bridge HMAC keys and live worker sessions are **not** written by this layer. Storing a key would require an explicit encryption/key-management design and user-facing retention policy; neither is implied by generic persistence.

The layer accepts JSON values only. Callers must scope and minimize what they store; Phase 3 context scoping and Phase 4 memory policies determine what agent information is eligible for persistence.

## Validation

The unit suite covers:

- Empty, literal, repeated, and long LZ4 round trips; compression effectiveness; malformed compressed data rejection.
- Small `chrome.storage.local` values and compressed IndexedDB records.
- Record listing/removal, serialized concurrent mutations, and index repair.
- Quota, size-cap, invalid-key/JSON, and integrity-corruption failures.

Storage modules are included in the same enforced 80% global coverage scope as the core, bridge, and background code. The full current suite passes above that threshold.

## Next step

With all Phase 0 subphases complete, implementation proceeds to **Phase 1A — DOMObserver v2**. The observer will use the signed bridge’s scoped DOM model, report structured mutation data, and avoid full `document.body` rescans.
