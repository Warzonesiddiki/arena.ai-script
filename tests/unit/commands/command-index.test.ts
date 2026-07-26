import { CommandIndex, ScopedMemoryGraph } from '../../../src/commands/command-index';

describe('CommandIndex', () => {
  it('combines lexical-semantic relevance with deterministic frecency', () => {
    let now = 1_000;
    const index = new CommandIndex({ now: () => now });
    index.register({ id: 'settings', title: 'Open settings', description: 'Configure extension preferences', category: 'Extension', keywords: ['preferences'] });
    index.register({ id: 'refresh', title: 'Refresh Arena status', description: 'Update scoped connection status', category: 'Status' });

    expect(index.search('preference')[0]?.id).toBe('settings');
    index.recordUse('refresh');
    index.recordUse('refresh');
    now += 100;
    expect(index.search('')[0]?.id).toBe('refresh');
  });

  it('searches only caller-scoped memory nodes alongside commands', () => {
    const graph = new ScopedMemoryGraph();
    graph.register({ id: 'artifact:one', label: 'Budget report', summary: 'Workflow cost report', terms: ['spend', 'governance'] });
    const index = new CommandIndex({ memoryGraph: graph });
    index.register({ id: 'settings', title: 'Open settings', description: 'Configure preferences', category: 'Extension' });

    expect(index.searchWorkspace('governance')).toEqual({
      commands: [],
      memory: [expect.objectContaining({ id: 'artifact:one', matchedTerms: ['governance'] })],
    });
    expect(() => graph.register({ id: 'bad id', label: '', summary: '', terms: [] })).toThrow(TypeError);
  });

  it('validates command identifiers and unknown usage', () => {
    const index = new CommandIndex();
    expect(() => index.register({ id: 'bad id', title: 'x', description: 'x', category: 'x' })).toThrow(TypeError);
    expect(() => index.recordUse('missing')).toThrow('Unknown command');
  });
});
