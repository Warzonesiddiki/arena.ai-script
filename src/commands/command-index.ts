export interface CommandDefinition {
  id: string;
  title: string;
  description: string;
  category: string;
  keywords?: readonly string[];
}

export interface CommandResult extends CommandDefinition {
  score: number;
  matchedTerms: readonly string[];
}

interface Usage {
  count: number;
  lastUsedAt: number;
}

export interface CommandIndexOptions {
  now?: () => number;
}

/** Deterministic lexical-semantic + frecency command search with no prompt/context retention. */
export class CommandIndex {
  private readonly definitions = new Map<string, CommandDefinition>();
  private readonly usage = new Map<string, Usage>();
  private readonly now: () => number;

  public constructor(options: CommandIndexOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  public register(command: CommandDefinition): void {
    validate(command);
    this.definitions.set(command.id, { ...command, keywords: [...(command.keywords ?? [])] });
  }

  public recordUse(id: string): void {
    if (!this.definitions.has(id)) throw new Error(`Unknown command "${id}".`);
    const prior = this.usage.get(id) ?? { count: 0, lastUsedAt: 0 };
    this.usage.set(id, { count: prior.count + 1, lastUsedAt: this.now() });
  }

  public search(query: string, limit = 20): CommandResult[] {
    const terms = tokenize(query);
    return [...this.definitions.values()]
      .map((command) => this.score(command, terms))
      .filter((result) => result.score > 0)
      .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
      .slice(0, limit);
  }

  private score(command: CommandDefinition, terms: readonly string[]): CommandResult {
    const document = `${command.title} ${command.description} ${command.category} ${(command.keywords ?? []).join(' ')}`.toLowerCase();
    const matchedTerms = terms.filter((term) => document.includes(term));
    const semantic = terms.length === 0 ? 1 : matchedTerms.length / terms.length;
    const fuzzy = terms.reduce((total, term) => total + subsequenceScore(command.title.toLowerCase(), term), 0);
    const usage = this.usage.get(command.id);
    const frequency = usage ? Math.log2(usage.count + 1) * 0.12 : 0;
    const recency = usage ? Math.max(0, 1 - (this.now() - usage.lastUsedAt) / (7 * 24 * 60 * 60 * 1000)) * 0.18 : 0;
    const score = semantic * 0.7 + fuzzy * 0.2 + frequency + recency;
    return { ...command, score, matchedTerms };
  }
}

function tokenize(value: string): string[] {
  return [...new Set(value.toLowerCase().split(/[^a-z0-9]+/u).filter((term) => term.length > 1))];
}

function subsequenceScore(haystack: string, needle: string): number {
  let position = 0;
  for (const character of needle) {
    position = haystack.indexOf(character, position);
    if (position < 0) return 0;
    position += 1;
  }
  return needle.length / Math.max(haystack.length, 1);
}

function validate(command: CommandDefinition): void {
  if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(command.id)) throw new TypeError('Command id is invalid.');
  if (!command.title.trim() || !command.description.trim() || !command.category.trim()) throw new TypeError('Commands require title, description, and category.');
}
