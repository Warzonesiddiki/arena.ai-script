import type { ScopedContext, ScopedFile } from './types';

export interface ContextScopeOptions { maxFiles?: number; maxCharsPerFile?: number; }

/** Builds minimal task context from explicitly named files; conversation history is never accepted. */
export class ContextScopeEngine {
  private readonly maxFiles: number;
  private readonly maxCharsPerFile: number;

  public constructor(options: ContextScopeOptions = {}) {
    this.maxFiles = options.maxFiles ?? 8;
    this.maxCharsPerFile = options.maxCharsPerFile ?? 12_000;
  }

  public scope(goal: string, requestedPaths: readonly string[], available: readonly ScopedFile[]): ScopedContext {
    const files: ScopedFile[] = [];
    let truncated = false;
    for (const path of [...new Set(requestedPaths)].slice(0, this.maxFiles)) {
      const file = available.find((candidate) => candidate.path === path);
      if (!file) continue;
      if (file.content.length > this.maxCharsPerFile) truncated = true;
      files.push({ path: file.path, content: file.content.slice(0, this.maxCharsPerFile) });
    }
    if (requestedPaths.length > this.maxFiles) truncated = true;
    return { goal: goal.slice(0, 4_000), files, truncated, snapshotId: snapshotId(goal, files) };
  }
}

function snapshotId(goal: string, files: readonly ScopedFile[]): string {
  let hash = 2166136261;
  for (const character of `${goal}\n${files.map((file) => `${file.path}:${file.content.length}`).join('|')}`) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }
  return `scope-${(hash >>> 0).toString(36)}`;
}
