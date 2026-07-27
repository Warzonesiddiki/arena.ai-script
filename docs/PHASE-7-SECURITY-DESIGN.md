# Phase 7 Security Design — Deep Integrations (prerequisite, not an implementation)

**Status:** Design and egress gate complete. **Integrations intentionally NOT implemented.**

**Date:** 2026-07-27

**Blueprint reference:** [Phase 7](20-PHASE-BLUEPRINT.md#phase-7-deep-integrations)

---

## Why this document exists instead of Phase 7 features

Phase 7 calls for GitHub, Linear/Notion, VS Code, Slack/Discord, and file-system integrations. Every one of them needs at least one of:

- new `host_permissions` for third-party origins,
- OAuth tokens or API keys, i.e. **long-lived secrets at rest**,
- outbound network egress from the service worker,
- local file read/write.

The project's standing security rules require that permissions are added only with matching implementation and manifest tests, that secrets are never persisted without a dedicated key-management design, and that any new channel is adversarially tested. Shipping a GitHub client today would break all three.

So Phase 7 delivers the **prerequisite** rather than a false-complete feature: an executable, adversarially-tested egress policy that any future integration must pass through, plus the honest list of what is still missing.

## What was delivered

| Artifact | Responsibility |
|---|---|
| `src/integrations/egress-policy.ts` | Deny-by-default egress rules, connector allow lists, approval gates, required-permission reporting |
| `tests/unit/integrations/egress-policy.test.ts` | 11 adversarial tests including a no-network-I/O source assertion and a manifest non-regression check |

### The gate performs no network I/O

There is no `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, or dynamic `import()` in the module. A test asserts this **against the source text** (with comments stripped, so the doc block explaining the rule is not mistaken for a violation). The gate only answers *"would this request be permitted?"* — a permitted verdict authorises nothing.

A second test asserts the shipped manifest still grants **only** Arena hosts and none of `downloads`, `webRequest`, or `cookies`. If a future change quietly widens the manifest, that test fails.

### Policy rules (deny-by-default, first failing check wins)

| Rule | Rationale |
|---|---|
| Unknown connector → deny | Default is refusal, not permission |
| Connector must be human-approved and enabled | No silent activation |
| `https:` only | No cleartext egress |
| No credentials in URL | Prevents token leakage via logs/referrers |
| Exact hosts only — **wildcards rejected at registration** | A wildcard is how an allow list leaks |
| Private/link-local/metadata hosts blocked | Blocks SSRF to `127.0.0.1`, `169.254.169.254`, `*.internal`, RFC1918 |
| Method allow list | No unexpected writes |
| Path prefix allow list, matched on a **path boundary** | `/repos` must not match `/repositories` |
| Scope allow list | Least privilege per connector |
| Bounded body size | No unbounded exfiltration |
| Redirects denied unless explicitly enabled | A redirect can move egress off the allow list |

## What is still required before ANY Phase 7 integration ships

1. **Key management design.** Where OAuth tokens live, how they are encrypted at rest, rotation, revocation, and what happens on extension update. No secret may be persisted until this exists.
2. **Manifest permission request + test update** for each specific host, mirroring how `alarms` was added in Phase 5B.
3. **Per-connector rate limiting and quota** to bound abuse and cost.
4. **Human approval per outbound action**, not merely per connector — consistent with the project-wide no-auto-execution default.
5. **Audit logging** of every attempted and permitted egress, through the existing bounded tracer.
6. **Adversarial test suite** covering token exfiltration, SSRF, redirect escape, DNS rebinding, and confused-deputy attacks from Arena page content.
7. **File-system design (7E)** is separate and stricter: directory scoping, symlink escape prevention, and per-write approval.

Until all seven exist and are reviewed, `EgressPolicy` remains what it is today: a gate with nothing behind it.

## Safety boundaries

This work does **not**:

- perform any network request or file access,
- add any permission or host permission,
- store any credential,
- enable any third-party integration, or
- change what the extension is capable of reaching.

## Honest status

**Phase 7 is NOT complete.** 7A–7E remain unimplemented by deliberate decision. The blueprint and index reflect this rather than claiming delivery.
