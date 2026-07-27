import { Tracer } from '../observability/tracer';
import { StorageLayer } from '../storage/storage-layer';

const STORAGE_KEY = 'memory:graph:v1';
const SCHEMA_VERSION = 1;
const MAX_TITLE_CHARS = 160;
const MAX_SUMMARY_CHARS = 1_200;
const MAX_TAGS = 16;
const MAX_TAG_CHARS = 40;
const MAX_FILE_PATHS = 12;
const MAX_FILE_PATH_CHARS = 160;
const MAX_EVIDENCE = 5;
const MAX_EVIDENCE_EXCERPT_CHARS = 500;
const MAX_QUERY_CHARS = 500;
const MAX_RETRIEVAL_LIMIT = 20;
const FORBIDDEN_RAW_FIELDS = ['conversation', 'messages', 'rawContent', 'rawPrompt', 'prompt', 'completion', 'secret', 'apiKey', 'token'] as const;

export type AgentMemoryKind = 'decision' | 'artifact' | 'lesson' | 'constraint';
export type AgentMemorySourceType = 'manual' | 'approved-task-summary' | 'approved-reflection';
export type AgentMemoryRelation = 'supports' | 'supersedes' | 'relates-to' | 'derived-from';

export interface AgentMemoryEvidence {
  label: string;
  excerpt: string;
}

export interface AgentMemorySource {
  type: AgentMemorySourceType;
  approvedByHuman: true;
}

export interface AgentMemoryScope {
  workflowId?: string;
  taskId?: string;
  filePaths?: readonly string[];
}

export interface AgentMemoryInput {
  id?: string;
  title: string;
  summary: string;
  kind: AgentMemoryKind;
  tags?: readonly string[];
  scope?: AgentMemoryScope;
  evidence?: readonly AgentMemoryEvidence[];
  source: AgentMemorySource;
  expiresAt?: number | null;
}

export interface AgentMemoryEdge {
  fromId: string;
  toId: string;
  relation: AgentMemoryRelation;
  createdAt: number;
}

export interface AgentMemoryNode {
  id: string;
  title: string;
  summary: string;
  kind: AgentMemoryKind;
  tags: readonly string[];
  scope: Required<AgentMemoryScope>;
  evidence: readonly AgentMemoryEvidence[];
  source: AgentMemorySource;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
  embedding: readonly string[];
}

export interface AgentMemoryGraphRecord {
  schemaVersion: typeof SCHEMA_VERSION;
  nodes: readonly AgentMemoryNode[];
  edges: readonly AgentMemoryEdge[];
}

export interface MemoryRetrievalScope {
  memoryIds?: readonly string[];
  tags?: readonly string[];
  workflowId?: string;
  taskId?: string;
  filePaths?: readonly string[];
}

export interface AgentMemorySearchResult {
  node: AgentMemoryNode;
  score: number;
  matchedTerms: readonly string[];
}

export interface AgentMemoryGraphOptions {
  storage?: StorageLayer;
  tracer?: Tracer;
  now?: () => number;
  idFactory?: (input: AgentMemoryInput) => string;
  storageKey?: string;
}

export class AgentMemoryPolicyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'AgentMemoryPolicyError';
  }
}

/**
 * Phase 4A persistent memory graph.
 *
 * Persistence is explicit: callers must provide a human-approved summary node.
 * Retrieval is scoped: callers must provide bounded memory IDs, tags, workflow,
 * task, or file paths before any stored node can be returned.
 */
export class AgentMemoryGraph {
  private readonly storage: StorageLayer;
  private readonly tracer: Tracer;
  private readonly now: () => number;
  private readonly idFactory: (input: AgentMemoryInput) => string;
  private readonly storageKey: string;
  private record: AgentMemoryGraphRecord | null = null;
  private mutationQueue: Promise<void> = Promise.resolve();

  public constructor(options: AgentMemoryGraphOptions = {}) {
    this.storage = options.storage ?? new StorageLayer();
    this.tracer = options.tracer ?? new Tracer();
    this.now = options.now ?? Date.now;
    this.idFactory = options.idFactory ?? ((input) => `mem-${stableHash(`${input.kind}:${input.title}:${input.summary}`)}`);
    this.storageKey = options.storageKey ?? STORAGE_KEY;
  }

  public async initialize(): Promise<void> {
    if (this.record) return;
    const stored = await this.storage.getLarge<AgentMemoryGraphRecord>(this.storageKey);
    this.record = stored ? sanitizeStoredRecord(stored) : { schemaVersion: SCHEMA_VERSION, nodes: [], edges: [] };
  }

  public async remember(input: AgentMemoryInput): Promise<AgentMemoryNode> {
    assertNoRawFields(input);
    validateHumanApproval(input.source);
    const sanitized = sanitizeInput(input, this.idFactory(input), this.now());

    return this.runMutation(async () => {
      await this.initialize();
      const existing = this.record!.nodes.find((node) => node.id === sanitized.id);
      const node: AgentMemoryNode = existing
        ? { ...sanitized, createdAt: existing.createdAt, updatedAt: this.now() }
        : sanitized;
      const nodes = [...this.record!.nodes.filter((candidate) => candidate.id !== node.id), node]
        .sort((left, right) => left.id.localeCompare(right.id));
      this.record = { ...this.record!, nodes };
      await this.persist();
      this.tracer.record('memory.node.remembered', 'info', {
        memoryId: node.id,
        kind: node.kind,
        tagCount: node.tags.length,
        filePathCount: node.scope.filePaths.length,
      });
      return cloneNode(node);
    });
  }

  public async link(fromId: string, toId: string, relation: AgentMemoryRelation): Promise<AgentMemoryEdge> {
    validateIdentifier(fromId, 'fromId');
    validateIdentifier(toId, 'toId');
    validateRelation(relation);
    if (fromId === toId) throw new AgentMemoryPolicyError('Memory graph links require two distinct nodes.');

    return this.runMutation(async () => {
      await this.initialize();
      const fromExists = this.record!.nodes.some((node) => node.id === fromId);
      const toExists = this.record!.nodes.some((node) => node.id === toId);
      if (!fromExists || !toExists) throw new AgentMemoryPolicyError('Memory graph links require existing nodes.');
      const existing = this.record!.edges.find((edge) => edge.fromId === fromId && edge.toId === toId && edge.relation === relation);
      if (existing) return { ...existing };
      const edge: AgentMemoryEdge = { fromId, toId, relation, createdAt: this.now() };
      this.record = { ...this.record!, edges: [...this.record!.edges, edge] };
      await this.persist();
      this.tracer.record('memory.edge.linked', 'info', { fromId, toId, relation });
      return { ...edge };
    });
  }

  public async retrieve(query: string, scope: MemoryRetrievalScope, limit = 10): Promise<AgentMemorySearchResult[]> {
    await this.initialize();
    const boundedQuery = query.trim().slice(0, MAX_QUERY_CHARS);
    const terms = tokenize(boundedQuery);
    if (terms.length === 0) return [];
    const sanitizedScope = sanitizeRetrievalScope(scope);
    const boundedLimit = boundedSearchLimit(limit);
    const timestamp = this.now();

    const results = this.record!.nodes
      .filter((node) => !node.expiresAt || node.expiresAt > timestamp)
      .filter((node) => matchesScope(node, sanitizedScope))
      .map((node) => scoreNode(node, terms))
      .filter((result) => result.score > 0)
      .sort((left, right) => right.score - left.score || left.node.title.localeCompare(right.node.title))
      .slice(0, boundedLimit)
      .map((result) => ({ ...result, node: cloneNode(result.node), matchedTerms: [...result.matchedTerms] }));

    this.tracer.record('memory.nodes.retrieved', 'info', {
      queryTermCount: terms.length,
      resultCount: results.length,
      limit: boundedLimit,
      scopedByIds: Boolean(sanitizedScope.memoryIds?.length),
      scopedByTags: Boolean(sanitizedScope.tags?.length),
      scopedByWorkflow: Boolean(sanitizedScope.workflowId),
      scopedByFiles: Boolean(sanitizedScope.filePaths?.length),
    });
    return results;
  }

  public async forget(memoryId: string): Promise<boolean> {
    validateIdentifier(memoryId, 'memoryId');
    return this.runMutation(async () => {
      await this.initialize();
      const before = this.record!.nodes.length;
      const nodes = this.record!.nodes.filter((node) => node.id !== memoryId);
      const edges = this.record!.edges.filter((edge) => edge.fromId !== memoryId && edge.toId !== memoryId);
      const removed = nodes.length !== before;
      if (removed) {
        this.record = { ...this.record!, nodes, edges };
        await this.persist();
        this.tracer.record('memory.node.forgotten', 'info', { memoryId });
      }
      return removed;
    });
  }

  public async exportScopedNodes(scope: MemoryRetrievalScope, limit = 20): Promise<readonly AgentMemoryNode[]> {
    await this.initialize();
    const sanitizedScope = sanitizeRetrievalScope(scope);
    const boundedLimit = boundedSearchLimit(limit);
    return this.record!.nodes
      .filter((node) => !node.expiresAt || node.expiresAt > this.now())
      .filter((node) => matchesScope(node, sanitizedScope))
      .sort((left, right) => right.updatedAt - left.updatedAt || left.title.localeCompare(right.title))
      .slice(0, boundedLimit)
      .map(cloneNode);
  }

  public async snapshot(): Promise<AgentMemoryGraphRecord> {
    await this.initialize();
    return cloneRecord(this.record!);
  }

  private async persist(): Promise<void> {
    await this.storage.putLarge(this.storageKey, this.record);
  }

  private async runMutation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationQueue;
    let release: (() => void) | undefined;
    this.mutationQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release?.();
    }
  }
}

function sanitizeInput(input: AgentMemoryInput, fallbackId: string, timestamp: number): AgentMemoryNode {
  const id = input.id ?? fallbackId;
  validateIdentifier(id, 'memoryId');
  validateKind(input.kind);
  const title = boundedText(input.title, 'title', MAX_TITLE_CHARS);
  const summary = boundedText(input.summary, 'summary', MAX_SUMMARY_CHARS);
  const tags = normalizeList(input.tags ?? [], MAX_TAGS, MAX_TAG_CHARS, 'tag');
  const scope = sanitizeNodeScope(input.scope ?? {});
  const evidence = sanitizeEvidence(input.evidence ?? []);
  const expiresAt = input.expiresAt ?? null;
  if (expiresAt !== null && (!Number.isSafeInteger(expiresAt) || expiresAt <= timestamp)) {
    throw new AgentMemoryPolicyError('expiresAt must be a future safe-integer timestamp when provided.');
  }
  const embedding = tokenize(`${title} ${summary} ${tags.join(' ')} ${evidence.map((item) => `${item.label} ${item.excerpt}`).join(' ')}`);
  return {
    id,
    title,
    summary,
    kind: input.kind,
    tags,
    scope,
    evidence,
    source: { ...input.source },
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt,
    embedding,
  };
}

function sanitizeStoredRecord(record: AgentMemoryGraphRecord): AgentMemoryGraphRecord {
  if (record.schemaVersion !== SCHEMA_VERSION || !Array.isArray(record.nodes) || !Array.isArray(record.edges)) {
    throw new AgentMemoryPolicyError('Stored memory graph has an unsupported schema.');
  }
  return cloneRecord(record);
}

function sanitizeNodeScope(scope: AgentMemoryScope): Required<AgentMemoryScope> {
  const workflowId = scope.workflowId ?? '';
  const taskId = scope.taskId ?? '';
  if (workflowId) validateIdentifier(workflowId, 'workflowId');
  if (taskId) validateIdentifier(taskId, 'taskId');
  return {
    workflowId,
    taskId,
    filePaths: normalizeList(scope.filePaths ?? [], MAX_FILE_PATHS, MAX_FILE_PATH_CHARS, 'filePath', false),
  };
}

function sanitizeRetrievalScope(scope: MemoryRetrievalScope): Required<MemoryRetrievalScope> {
  const memoryIds = normalizeList(scope.memoryIds ?? [], MAX_RETRIEVAL_LIMIT, 128, 'memoryId', false);
  memoryIds.forEach((id) => validateIdentifier(id, 'memoryId'));
  const tags = normalizeList(scope.tags ?? [], MAX_TAGS, MAX_TAG_CHARS, 'tag');
  const workflowId = scope.workflowId ?? '';
  const taskId = scope.taskId ?? '';
  if (workflowId) validateIdentifier(workflowId, 'workflowId');
  if (taskId) validateIdentifier(taskId, 'taskId');
  const filePaths = normalizeList(scope.filePaths ?? [], MAX_FILE_PATHS, MAX_FILE_PATH_CHARS, 'filePath', false);
  if (memoryIds.length === 0 && tags.length === 0 && !workflowId && !taskId && filePaths.length === 0) {
    throw new AgentMemoryPolicyError('Memory retrieval requires an explicit scope.');
  }
  return { memoryIds, tags, workflowId, taskId, filePaths };
}

function sanitizeEvidence(evidence: readonly AgentMemoryEvidence[]): readonly AgentMemoryEvidence[] {
  return evidence.slice(0, MAX_EVIDENCE).map((item) => ({
    label: boundedText(item.label, 'evidence label', 80),
    excerpt: boundedText(item.excerpt, 'evidence excerpt', MAX_EVIDENCE_EXCERPT_CHARS),
  }));
}

function matchesScope(node: AgentMemoryNode, scope: Required<MemoryRetrievalScope>): boolean {
  return (scope.memoryIds.length > 0 && scope.memoryIds.includes(node.id))
    || (scope.tags.length > 0 && scope.tags.some((tag) => node.tags.includes(tag)))
    || Boolean(scope.workflowId && node.scope.workflowId === scope.workflowId)
    || Boolean(scope.taskId && node.scope.taskId === scope.taskId)
    || (scope.filePaths.length > 0 && scope.filePaths.some((path) => node.scope.filePaths.includes(path)));
}

function scoreNode(node: AgentMemoryNode, queryTerms: readonly string[]): AgentMemorySearchResult {
  const termSet = new Set(node.embedding);
  const matchedTerms = queryTerms.filter((term) => termSet.has(term));
  const titleTerms = new Set(tokenize(node.title));
  const titleBoost = matchedTerms.filter((term) => titleTerms.has(term)).length * 0.2;
  const tagBoost = matchedTerms.filter((term) => node.tags.includes(term)).length * 0.15;
  const score = matchedTerms.length / queryTerms.length + titleBoost + tagBoost;
  return { node, score, matchedTerms };
}

function validateHumanApproval(source: AgentMemorySource): void {
  if (!source || source.approvedByHuman !== true) throw new AgentMemoryPolicyError('Memory persistence requires explicit human approval.');
  if (!['manual', 'approved-task-summary', 'approved-reflection'].includes(source.type)) {
    throw new AgentMemoryPolicyError('Memory source type is invalid.');
  }
}

function assertNoRawFields(input: AgentMemoryInput): void {
  const record = input as unknown as Record<string, unknown>;
  for (const field of FORBIDDEN_RAW_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(record, field)) {
      throw new AgentMemoryPolicyError(`Raw field "${field}" is not allowed in persistent memory.`);
    }
  }
}

function validateKind(kind: AgentMemoryKind): void {
  if (!['decision', 'artifact', 'lesson', 'constraint'].includes(kind)) throw new AgentMemoryPolicyError('Memory kind is invalid.');
}

function validateRelation(relation: AgentMemoryRelation): void {
  if (!['supports', 'supersedes', 'relates-to', 'derived-from'].includes(relation)) throw new AgentMemoryPolicyError('Memory relation is invalid.');
}

function validateIdentifier(value: string, name: string): void {
  if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(value)) throw new AgentMemoryPolicyError(`${name} is invalid.`);
}

function boundedText(value: string, name: string, maxChars: number): string {
  if (typeof value !== 'string') throw new AgentMemoryPolicyError(`${name} must be a string.`);
  const trimmed = value.trim();
  if (!trimmed) throw new AgentMemoryPolicyError(`${name} is required.`);
  return trimmed.slice(0, maxChars);
}

function normalizeList(values: readonly string[], maxItems: number, maxChars: number, name: string, lowercase = true): string[] {
  return [...new Set(values.map((value) => {
    const bounded = boundedText(value, name, maxChars);
    return lowercase ? bounded.toLowerCase() : bounded;
  }))].slice(0, maxItems);
}

function boundedSearchLimit(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new AgentMemoryPolicyError('Memory search limit must be a positive safe integer.');
  return Math.min(limit, MAX_RETRIEVAL_LIMIT);
}

function tokenize(value: string): string[] {
  return [...new Set(value.toLowerCase().split(/[^a-z0-9._:-]+/u).filter((term) => term.length > 1))].slice(0, 100);
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36);
}

function cloneNode(node: AgentMemoryNode): AgentMemoryNode {
  return {
    ...node,
    tags: [...node.tags],
    scope: { ...node.scope, filePaths: [...node.scope.filePaths] },
    evidence: node.evidence.map((item) => ({ ...item })),
    source: { ...node.source },
    embedding: [...node.embedding],
  };
}

function cloneRecord(record: AgentMemoryGraphRecord): AgentMemoryGraphRecord {
  return {
    schemaVersion: SCHEMA_VERSION,
    nodes: record.nodes.map(cloneNode),
    edges: record.edges.map((edge) => ({ ...edge })),
  };
}
