import { IDBFactory } from 'fake-indexeddb';
import { AgentMemoryGraph, AgentMemoryPolicyError, type AgentMemoryInput } from '../../../src/memory/agent-memory-graph';
import { Tracer } from '../../../src/observability/tracer';
import { StorageLayer, type ChromeStorageArea } from '../../../src/storage/storage-layer';

class MemoryChromeStorage implements ChromeStorageArea {
  public readonly values = new Map<string, unknown>();

  public async get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>> {
    const requested = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : keys ? Object.keys(keys) : [...this.values.keys()];
    return Object.fromEntries(requested.flatMap((key) => this.values.has(key) ? [[key, this.values.get(key)]] : []));
  }

  public async set(items: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(items)) this.values.set(key, value);
  }

  public async remove(keys: string | string[]): Promise<void> {
    for (const key of typeof keys === 'string' ? [keys] : keys) this.values.delete(key);
  }
}

function makeStorage(
  indexedDbFactory = new IDBFactory(),
  chromeStorage = new MemoryChromeStorage(),
  databaseName = `aamp-memory-${Math.random().toString(36).slice(2)}`,
  now = () => 1_800_000_000_000,
): StorageLayer {
  return new StorageLayer({
    chromeStorage,
    indexedDbFactory,
    databaseName,
    now,
    estimate: async () => ({ usage: 0, quota: 200 * 1024 * 1024 }),
  });
}

function approvedMemory(overrides: Partial<AgentMemoryInput> = {}): AgentMemoryInput {
  return {
    id: 'mem:planner-validation',
    title: 'Planner validation decision',
    summary: 'Planner tasks must be approved before coder tasks can proceed.',
    kind: 'decision',
    tags: ['phase4a', 'approval', 'planner'],
    scope: { workflowId: 'workflow:one', taskId: 'planner-1', filePaths: ['src/orchestration/dashboard-state.ts'] },
    evidence: [{ label: 'Implementation note', excerpt: 'The dashboard state enforces approval order without storing chat transcripts.' }],
    source: { type: 'manual', approvedByHuman: true },
    ...overrides,
  };
}

describe('AgentMemoryGraph', () => {
  it('persists only explicitly approved summarized memory nodes in IndexedDB storage', async () => {
    const tracer = new Tracer({ now: () => 10, idFactory: () => 'trace-id' });
    const indexedDbFactory = new IDBFactory();
    const chromeStorage = new MemoryChromeStorage();
    const databaseName = 'aamp-memory-persist';
    const graph = new AgentMemoryGraph({
      storage: makeStorage(indexedDbFactory, chromeStorage, databaseName),
      tracer,
      now: () => 1_800_000_000_000,
    });

    const node = await graph.remember(approvedMemory({ summary: 'x'.repeat(1_500) }));

    expect(node.summary).toHaveLength(1_200);
    expect(node.scope.filePaths).toEqual(['src/orchestration/dashboard-state.ts']);
    expect(node.embedding).toContain('planner');
    expect(tracer.getEvents().map((event) => event.name)).toContain('memory.node.remembered');

    const reloaded = new AgentMemoryGraph({
      storage: makeStorage(indexedDbFactory, chromeStorage, databaseName),
      now: () => 1_800_000_000_001,
    });
    await expect(reloaded.snapshot()).resolves.toEqual(expect.objectContaining({
      nodes: [expect.objectContaining({ id: 'mem:planner-validation', summary: 'x'.repeat(1_200) })],
    }));
  });

  it('rejects unapproved or raw conversation-like persistence attempts', async () => {
    const graph = new AgentMemoryGraph({ storage: makeStorage() });

    await expect(graph.remember(approvedMemory({ source: { type: 'manual', approvedByHuman: false } as never })))
      .rejects.toBeInstanceOf(AgentMemoryPolicyError);
    await expect(graph.remember({ ...approvedMemory(), conversation: [{ role: 'user', content: 'full chat' }] } as unknown as AgentMemoryInput))
      .rejects.toThrow(/Raw field/u);
    await expect(graph.remember(approvedMemory({ title: '   ' }))).rejects.toBeInstanceOf(AgentMemoryPolicyError);
  });

  it('requires explicit scoped retrieval and ranks only matching scoped nodes', async () => {
    const tracer = new Tracer({ now: () => 10, idFactory: () => 'trace-id' });
    const graph = new AgentMemoryGraph({ storage: makeStorage(), tracer, now: () => 1_800_000_000_000 });
    await graph.remember(approvedMemory());
    await graph.remember(approvedMemory({
      id: 'mem:storage-quota',
      title: 'Storage quota lesson',
      summary: 'Large records use quota checks before IndexedDB writes.',
      kind: 'lesson',
      tags: ['storage'],
      scope: { workflowId: 'workflow:two', filePaths: ['src/storage/storage-layer.ts'] },
    }));

    await expect(graph.retrieve('planner approval', {}, 10)).rejects.toBeInstanceOf(AgentMemoryPolicyError);
    expect(await graph.retrieve('planner approval quota', { workflowId: 'workflow:one' }, 10)).toEqual([
      expect.objectContaining({
        node: expect.objectContaining({ id: 'mem:planner-validation' }),
        matchedTerms: expect.arrayContaining(['planner', 'approval']),
      }),
    ]);
    expect(await graph.retrieve('quota indexeddb', { tags: ['storage'] }, 10)).toEqual([
      expect.objectContaining({ node: expect.objectContaining({ id: 'mem:storage-quota' }) }),
    ]);
    expect(await graph.retrieve('planner', { filePaths: ['src/unknown.ts'] }, 10)).toEqual([]);
    expect(tracer.getEvents().map((event) => event.name)).toContain('memory.nodes.retrieved');
  });

  it('links existing nodes and removes edges when a node is forgotten', async () => {
    const graph = new AgentMemoryGraph({ storage: makeStorage(), now: () => 1_800_000_000_000 });
    await graph.remember(approvedMemory());
    await graph.remember(approvedMemory({
      id: 'mem:critic-review',
      title: 'Critic review constraint',
      summary: 'Critic review waits for coder completion.',
      kind: 'constraint',
      tags: ['critic'],
      scope: { workflowId: 'workflow:one', taskId: 'critic-1' },
    }));

    await expect(graph.link('mem:planner-validation', 'mem:critic-review', 'supports')).resolves.toEqual(expect.objectContaining({ relation: 'supports' }));
    await expect(graph.link('mem:missing', 'mem:critic-review', 'supports')).rejects.toBeInstanceOf(AgentMemoryPolicyError);
    expect((await graph.snapshot()).edges).toHaveLength(1);
    await expect(graph.forget('mem:critic-review')).resolves.toBe(true);
    expect(await graph.forget('mem:critic-review')).toBe(false);
    expect((await graph.snapshot()).edges).toHaveLength(0);
  });

  it('omits expired memories and exports bounded scoped summaries', async () => {
    let currentTime = 1_800_000_000_000;
    const graph = new AgentMemoryGraph({
      storage: makeStorage(new IDBFactory(), new MemoryChromeStorage(), 'aamp-memory-expiry', () => currentTime),
      now: () => currentTime,
    });
    await graph.remember(approvedMemory({ id: 'mem:active', title: 'Active approval memory', expiresAt: 1_800_000_000_100 }));
    await graph.remember(approvedMemory({ id: 'mem:other', title: 'Other approval memory', tags: ['other'], scope: { workflowId: 'workflow:other' } }));

    expect(await graph.retrieve('active approval', { memoryIds: ['mem:active'] }, 10)).toHaveLength(1);
    const exported = await graph.exportScopedNodes({ workflowId: 'workflow:one' }, 1);
    expect(exported).toHaveLength(1);
    expect(exported[0]).toEqual(expect.objectContaining({ id: 'mem:active', summary: expect.any(String) }));

    currentTime = 1_800_000_000_200;
    expect(await graph.retrieve('active approval', { memoryIds: ['mem:active'] }, 10)).toEqual([]);
    expect(await graph.exportScopedNodes({ workflowId: 'workflow:one' }, 10)).toEqual([]);
  });
});
