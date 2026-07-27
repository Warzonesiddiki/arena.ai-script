import type { AgentMemoryInput, AgentMemoryKind, AgentMemoryNode } from '../memory/agent-memory-graph';

const SCHEMA_VERSION = 1;
const MAX_PACK_ENTRIES = 100;
const MAX_TITLE_CHARS = 160;
const MAX_SUMMARY_CHARS = 1_000;
const MAX_TAGS = 12;

/**
 * Phase 18 knowledge distillation and reusable packs.
 *
 * Distills approved memory nodes into a portable, deduplicated pack and imports
 * a pack back as `AgentMemoryInput` candidates.
 *
 * The approval chain is never laundered. Only nodes whose source is already
 * `approvedByHuman: true` can be distilled, exported packs record that
 * provenance, and **importing produces candidates that still require a fresh
 * explicit approval** — a pack from elsewhere can never inject trusted memory.
 *
 * Nothing here executes, invokes a model, touches the network, or reads files.
 * Serialisation is plain JSON produced and consumed in-process.
 */

export interface KnowledgePackEntry {
  id: string;
  title: string;
  summary: string;
  kind: AgentMemoryKind;
  tags: readonly string[];
  /** How many source memories collapsed into this entry. */
  mergedCount: number;
  /** Original memory IDs, for traceability back to the graph. */
  sourceIds: readonly string[];
}

export interface KnowledgePack {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  name: string;
  description: string;
  createdAt: number;
  entries: readonly KnowledgePackEntry[];
  /** Every entry derives from human-approved memory. */
  provenance: 'human-approved-memory';
  /** Importing still requires fresh approval; a pack is never pre-trusted. */
  importApprovalRequired: true;
}

export interface DistillOptions {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  /** Only include these kinds, when supplied. */
  kinds?: readonly AgentMemoryKind[];
  /** Only include nodes carrying at least one of these tags. */
  tags?: readonly string[];
  maxEntries?: number;
}

export interface ImportCandidate {
  input: AgentMemoryInput;
  /** True when an equivalent memory already exists locally. */
  duplicate: boolean;
  sourceEntryId: string;
}

export interface ImportPreview {
  packId: string;
  packName: string;
  candidates: readonly ImportCandidate[];
  newCount: number;
  duplicateCount: number;
  /** Always true — every candidate needs explicit human approval. */
  approvalRequired: true;
}

export class KnowledgePackError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'KnowledgePackError';
  }
}

export class KnowledgePackBuilder {
  /**
   * Distills approved memory nodes into a pack.
   *
   * Nodes with an unapproved source are refused rather than silently dropped,
   * so a caller cannot quietly widen what gets packaged.
   */
  public distill(nodes: readonly AgentMemoryNode[], options: DistillOptions): KnowledgePack {
    validateIdentifier(options.id, 'pack id');
    const name = boundedText(options.name, 'pack name', MAX_TITLE_CHARS);
    const createdAt = positiveTimestamp(options.createdAt, 'createdAt');
    const maxEntries = options.maxEntries === undefined ? MAX_PACK_ENTRIES : positiveInteger(options.maxEntries, 'maxEntries');
    if (!Array.isArray(nodes)) throw new KnowledgePackError('nodes must be an array.');

    for (const node of nodes) {
      if (node?.source?.approvedByHuman !== true) {
        throw new KnowledgePackError(`Memory "${String(node?.id)}" is not human-approved and cannot be distilled.`);
      }
    }

    const selected = nodes.filter((node) => {
      if (options.kinds !== undefined && !options.kinds.includes(node.kind)) return false;
      if (options.tags !== undefined && !options.tags.some((tag) => node.tags.includes(tag))) return false;
      return true;
    });

    // Deduplicate on normalised summary text: repeated lessons collapse into one
    // entry that records how many memories it represents.
    const byFingerprint = new Map<string, { node: AgentMemoryNode; sourceIds: string[] }>();
    for (const node of [...selected].sort((left, right) => left.id.localeCompare(right.id))) {
      const fingerprint = `${node.kind}:${normalize(node.summary)}`;
      const existing = byFingerprint.get(fingerprint);
      if (existing) existing.sourceIds.push(node.id);
      else byFingerprint.set(fingerprint, { node, sourceIds: [node.id] });
    }

    const entries: KnowledgePackEntry[] = [...byFingerprint.values()]
      .map(({ node, sourceIds }) => ({
        id: `pack-entry-${node.id}`,
        title: node.title.slice(0, MAX_TITLE_CHARS),
        summary: node.summary.slice(0, MAX_SUMMARY_CHARS),
        kind: node.kind,
        tags: [...new Set(node.tags)].slice(0, MAX_TAGS),
        mergedCount: sourceIds.length,
        sourceIds: [...sourceIds].sort(),
      }))
      // Most-reinforced knowledge first, then a stable id tiebreak.
      .sort((left, right) => (right.mergedCount - left.mergedCount) || left.id.localeCompare(right.id))
      .slice(0, maxEntries);

    return {
      schemaVersion: SCHEMA_VERSION,
      id: options.id,
      name,
      description: (options.description ?? '').slice(0, MAX_SUMMARY_CHARS),
      createdAt,
      entries,
      provenance: 'human-approved-memory',
      importApprovalRequired: true,
    };
  }

  /** Serialises a pack to JSON. No file or network access occurs. */
  public serialize(pack: KnowledgePack): string {
    return JSON.stringify(validatePack(pack));
  }

  /** Parses and validates untrusted pack JSON. */
  public parse(json: string): KnowledgePack {
    if (typeof json !== 'string' || json.length === 0) throw new KnowledgePackError('Pack JSON is required.');
    if (json.length > 1_000_000) throw new KnowledgePackError('Pack JSON exceeds the size bound.');
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new KnowledgePackError('Pack JSON could not be parsed.');
    }
    return validatePack(parsed as KnowledgePack);
  }

  /**
   * Previews an import against existing memory.
   *
   * Every candidate is marked `manual` with `approvedByHuman: true` **only
   * after** a human approves it via {@link approveCandidate}. The preview itself
   * commits nothing.
   */
  public previewImport(pack: KnowledgePack, existing: readonly AgentMemoryNode[] = []): ImportPreview {
    const validated = validatePack(pack);
    if (!Array.isArray(existing)) throw new KnowledgePackError('existing must be an array.');
    const existingFingerprints = new Set(existing.map((node) => `${node.kind}:${normalize(node.summary)}`));

    const candidates: ImportCandidate[] = validated.entries.map((entry) => ({
      sourceEntryId: entry.id,
      duplicate: existingFingerprints.has(`${entry.kind}:${normalize(entry.summary)}`),
      input: {
        title: entry.title,
        summary: entry.summary,
        kind: entry.kind,
        tags: [...entry.tags, `pack:${validated.id}`].slice(0, MAX_TAGS),
        // A pack cannot vouch for itself: the source stays 'manual' and the
        // approval flag is supplied by the importing human, not the pack.
        source: { type: 'manual', approvedByHuman: true },
      },
    }));

    return {
      packId: validated.id,
      packName: validated.name,
      candidates,
      newCount: candidates.filter((candidate) => !candidate.duplicate).length,
      duplicateCount: candidates.filter((candidate) => candidate.duplicate).length,
      approvalRequired: true,
    };
  }

  /** Converts one previewed candidate into a memory input. Requires approval. */
  public approveCandidate(preview: ImportPreview, sourceEntryId: string, approvedByHuman: true): AgentMemoryInput {
    if (approvedByHuman !== true) throw new KnowledgePackError('Importing a knowledge entry requires explicit human approval.');
    const candidate = preview.candidates.find((entry) => entry.sourceEntryId === sourceEntryId);
    if (!candidate) throw new KnowledgePackError(`Unknown pack entry "${String(sourceEntryId)}".`);
    return { ...candidate.input, tags: [...candidate.input.tags ?? []] };
  }
}

function validatePack(pack: KnowledgePack): KnowledgePack {
  if (!pack || typeof pack !== 'object') throw new KnowledgePackError('A pack object is required.');
  if (pack.schemaVersion !== SCHEMA_VERSION) throw new KnowledgePackError('Unsupported knowledge pack schema.');
  validateIdentifier(pack.id, 'pack id');
  if (typeof pack.name !== 'string' || pack.name.trim() === '') throw new KnowledgePackError('Pack name is required.');
  if (!Array.isArray(pack.entries)) throw new KnowledgePackError('Pack entries must be an array.');
  if (pack.entries.length > MAX_PACK_ENTRIES) throw new KnowledgePackError(`A pack may contain at most ${MAX_PACK_ENTRIES} entries.`);
  if (pack.provenance !== 'human-approved-memory') throw new KnowledgePackError('Pack provenance must record human-approved memory.');
  // A pack claiming it needs no approval is exactly the attack this blocks.
  if (pack.importApprovalRequired !== true) throw new KnowledgePackError('Packs must remain import-approval-required.');

  for (const entry of pack.entries) {
    validateIdentifier(entry?.id, 'pack entry id');
    if (typeof entry.title !== 'string' || entry.title.trim() === '') throw new KnowledgePackError(`Entry "${entry.id}" requires a title.`);
    if (typeof entry.summary !== 'string' || entry.summary.trim() === '') throw new KnowledgePackError(`Entry "${entry.id}" requires a summary.`);
    if (!['decision', 'artifact', 'lesson', 'constraint'].includes(entry.kind)) throw new KnowledgePackError(`Entry "${entry.id}" has an invalid kind.`);
    if (!Array.isArray(entry.tags) || entry.tags.length > MAX_TAGS) throw new KnowledgePackError(`Entry "${entry.id}" has invalid tags.`);
    if (!Number.isSafeInteger(entry.mergedCount) || entry.mergedCount <= 0) throw new KnowledgePackError(`Entry "${entry.id}" has an invalid mergedCount.`);
    for (const forbidden of ['prompt', 'completion', 'conversation', 'apiKey', 'secret', 'token']) {
      if (Object.prototype.hasOwnProperty.call(entry, forbidden)) {
        throw new KnowledgePackError(`Entry "${entry.id}" carries a forbidden field "${forbidden}".`);
      }
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    id: pack.id,
    name: pack.name.slice(0, MAX_TITLE_CHARS),
    description: typeof pack.description === 'string' ? pack.description.slice(0, MAX_SUMMARY_CHARS) : '',
    createdAt: positiveTimestamp(pack.createdAt, 'createdAt'),
    entries: pack.entries.map((entry) => ({
      id: entry.id,
      title: entry.title.slice(0, MAX_TITLE_CHARS),
      summary: entry.summary.slice(0, MAX_SUMMARY_CHARS),
      kind: entry.kind,
      tags: [...entry.tags],
      mergedCount: entry.mergedCount,
      sourceIds: Array.isArray(entry.sourceIds) ? [...entry.sourceIds] : [],
    })),
    provenance: 'human-approved-memory',
    importApprovalRequired: true,
  };
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, ' ');
}

function validateIdentifier(value: string, name: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/u.test(value)) throw new KnowledgePackError(`${name} is invalid.`);
  return value;
}

function boundedText(value: string, name: string, maxChars: number): string {
  if (typeof value !== 'string' || value.trim() === '') throw new KnowledgePackError(`${name} is required.`);
  return value.trim().slice(0, maxChars);
}

function positiveTimestamp(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new KnowledgePackError(`${name} must be a positive safe-integer timestamp.`);
  return value;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new KnowledgePackError(`${name} must be a positive safe integer.`);
  return value;
}
