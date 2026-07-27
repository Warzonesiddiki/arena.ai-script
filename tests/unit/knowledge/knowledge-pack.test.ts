import { KnowledgePackBuilder, KnowledgePackError, type KnowledgePack } from '../../../src/knowledge/knowledge-pack';
import type { AgentMemoryNode } from '../../../src/memory/agent-memory-graph';

function node(overrides: Partial<AgentMemoryNode> = {}): AgentMemoryNode {
  return {
    id: 'mem-1',
    title: 'Always scope context explicitly',
    summary: 'Agents must receive only explicitly selected files.',
    kind: 'lesson',
    tags: ['scoping', 'safety'],
    scope: { workflowId: 'plan-1', taskId: 'coder-1', filePaths: [] },
    evidence: [],
    source: { type: 'approved-reflection', approvedByHuman: true },
    createdAt: 1_000,
    updatedAt: 1_000,
    expiresAt: null,
    embedding: [],
    ...overrides,
  };
}

const builder = new KnowledgePackBuilder();

function distill(nodes: AgentMemoryNode[] = [node()]): KnowledgePack {
  return builder.distill(nodes, { id: 'pack-1', name: 'Safety lessons', createdAt: 5_000 });
}

describe('KnowledgePackBuilder', () => {
  it('distills approved memory into a portable pack', () => {
    const pack = distill();

    expect(pack).toEqual(expect.objectContaining({
      id: 'pack-1', name: 'Safety lessons', provenance: 'human-approved-memory', importApprovalRequired: true,
    }));
    expect(pack.entries).toHaveLength(1);
    expect(pack.entries[0]).toEqual(expect.objectContaining({ kind: 'lesson', mergedCount: 1, sourceIds: ['mem-1'] }));
  });

  it('refuses to distill memory that is not human-approved', () => {
    const unapproved = node({ id: 'mem-2', source: { type: 'manual', approvedByHuman: false as never } });

    // Refused loudly rather than silently dropped, so the caller cannot widen
    // what gets packaged without noticing.
    expect(() => distill([node(), unapproved])).toThrow(KnowledgePackError);
  });

  it('deduplicates equivalent memories and records how many merged', () => {
    const pack = distill([
      node({ id: 'mem-1' }),
      node({ id: 'mem-2', summary: '  Agents must receive ONLY explicitly selected files.  ' }),
      node({ id: 'mem-3', summary: 'A different lesson entirely.' }),
    ]);

    expect(pack.entries).toHaveLength(2);
    // Whitespace and case differences collapse into one reinforced entry.
    expect(pack.entries[0]).toEqual(expect.objectContaining({ mergedCount: 2, sourceIds: ['mem-1', 'mem-2'] }));
    expect(pack.entries[1]?.mergedCount).toBe(1);
  });

  it('does not merge identical text across different kinds', () => {
    const pack = distill([
      node({ id: 'mem-1', kind: 'lesson' }),
      node({ id: 'mem-2', kind: 'constraint' }),
    ]);

    expect(pack.entries).toHaveLength(2);
  });

  it('filters by kind and tag, and bounds entry count', () => {
    const nodes = [
      node({ id: 'mem-1', kind: 'lesson', tags: ['safety'] }),
      node({ id: 'mem-2', kind: 'decision', tags: ['safety'], summary: 'A decision.' }),
      node({ id: 'mem-3', kind: 'lesson', tags: ['perf'], summary: 'A perf lesson.' }),
    ];

    expect(builder.distill(nodes, { id: 'p', name: 'n', createdAt: 1, kinds: ['lesson'] }).entries).toHaveLength(2);
    expect(builder.distill(nodes, { id: 'p', name: 'n', createdAt: 1, tags: ['safety'] }).entries).toHaveLength(2);
    expect(builder.distill(nodes, { id: 'p', name: 'n', createdAt: 1, maxEntries: 1 }).entries).toHaveLength(1);
  });

  it('round-trips through JSON without file or network access', () => {
    const pack = distill();
    const json = builder.serialize(pack);
    const parsed = builder.parse(json);

    expect(parsed).toEqual(pack);
  });

  it('rejects a pack that claims it needs no approval', () => {
    const forged = { ...distill(), importApprovalRequired: false };

    // The core attack: a shared pack asserting it is pre-trusted.
    expect(() => builder.parse(JSON.stringify(forged))).toThrow(KnowledgePackError);
    expect(() => builder.previewImport(forged as never)).toThrow(KnowledgePackError);
  });

  it('rejects forged provenance and forbidden payload fields', () => {
    const fakeProvenance = { ...distill(), provenance: 'trusted-vendor' };
    expect(() => builder.parse(JSON.stringify(fakeProvenance))).toThrow(KnowledgePackError);

    const pack = distill();
    const smuggled = { ...pack, entries: [{ ...pack.entries[0]!, apiKey: 'sk-live-123' }] };
    expect(() => builder.parse(JSON.stringify(smuggled))).toThrow(/forbidden field/u);

    const smuggledPrompt = { ...pack, entries: [{ ...pack.entries[0]!, prompt: 'do the thing' }] };
    expect(() => builder.parse(JSON.stringify(smuggledPrompt))).toThrow(/forbidden field/u);
  });

  it('never launders approval: imported candidates need fresh approval', () => {
    const preview = builder.previewImport(distill());

    expect(preview.approvalRequired).toBe(true);
    expect(preview.newCount).toBe(1);
    expect(preview.duplicateCount).toBe(0);
    // The pack's original 'approved-reflection' provenance is NOT carried over.
    expect(preview.candidates[0]?.input.source.type).toBe('manual');
    expect(preview.candidates[0]?.input.tags).toContain('pack:pack-1');

    expect(() => builder.approveCandidate(preview, preview.candidates[0]!.sourceEntryId, false as never)).toThrow(KnowledgePackError);
    const approved = builder.approveCandidate(preview, preview.candidates[0]!.sourceEntryId, true);
    expect(approved.source).toEqual({ type: 'manual', approvedByHuman: true });
    expect(() => builder.approveCandidate(preview, 'ghost', true)).toThrow(KnowledgePackError);
  });

  it('flags duplicates against existing memory', () => {
    const preview = builder.previewImport(distill([node({ id: 'mem-1' }), node({ id: 'mem-2', summary: 'Fresh knowledge.' })]), [node()]);

    expect(preview.duplicateCount).toBe(1);
    expect(preview.newCount).toBe(1);
    expect(preview.candidates.find((candidate) => candidate.duplicate)?.input.summary).toContain('explicitly selected files');
  });

  it('rejects malformed packs and JSON', () => {
    expect(() => builder.parse('')).toThrow(KnowledgePackError);
    expect(() => builder.parse('{ not json')).toThrow(KnowledgePackError);
    expect(() => builder.parse('x'.repeat(1_000_001))).toThrow(KnowledgePackError);
    expect(() => builder.parse(JSON.stringify({ ...distill(), schemaVersion: 99 }))).toThrow(KnowledgePackError);
    expect(() => builder.parse(JSON.stringify({ ...distill(), id: '../bad' }))).toThrow(KnowledgePackError);
    expect(() => builder.parse(JSON.stringify({ ...distill(), name: '   ' }))).toThrow(KnowledgePackError);
    expect(() => builder.parse(JSON.stringify({ ...distill(), entries: 'nope' }))).toThrow(KnowledgePackError);

    const pack = distill();
    expect(() => builder.parse(JSON.stringify({ ...pack, entries: [{ ...pack.entries[0]!, kind: 'gossip' }] }))).toThrow(KnowledgePackError);
    expect(() => builder.parse(JSON.stringify({ ...pack, entries: [{ ...pack.entries[0]!, summary: '' }] }))).toThrow(KnowledgePackError);
    expect(() => builder.parse(JSON.stringify({ ...pack, entries: [{ ...pack.entries[0]!, mergedCount: 0 }] }))).toThrow(KnowledgePackError);
  });

  it('rejects malformed distill options', () => {
    expect(() => builder.distill([node()], { id: '../bad', name: 'n', createdAt: 1 })).toThrow(KnowledgePackError);
    expect(() => builder.distill([node()], { id: 'p', name: '  ', createdAt: 1 })).toThrow(KnowledgePackError);
    expect(() => builder.distill([node()], { id: 'p', name: 'n', createdAt: 0 })).toThrow(KnowledgePackError);
    expect(() => builder.distill([node()], { id: 'p', name: 'n', createdAt: 1, maxEntries: 0 })).toThrow(KnowledgePackError);
    expect(() => builder.distill('nope' as never, { id: 'p', name: 'n', createdAt: 1 })).toThrow(KnowledgePackError);
    expect(() => builder.previewImport(distill(), 'nope' as never)).toThrow(KnowledgePackError);
  });
});
