import { EventBus, type EventMap } from '../core/event-bus';

export interface DomMutationEvent {
  node: Node;
  mutations: readonly MutationRecord[];
  timestamp: number;
}

export interface DomObserverEvents extends EventMap {
  'dom:mutation': DomMutationEvent;
}

export interface DomObserverOptions {
  eventBus: EventBus<DomObserverEvents>;
  ignoreSelectors?: readonly string[];
  now?: () => number;
  observerFactory?: (callback: MutationCallback) => MutationObserver;
}

/**
 * One scoped MutationObserver for extension content code. It never observes
 * document.body as a fallback and never performs a full-document rescan.
 */
export class DomObserverV2 {
  private readonly eventBus: EventBus<DomObserverEvents>;
  private readonly ignoreSelectors: readonly string[];
  private readonly now: () => number;
  private readonly observerFactory: (callback: MutationCallback) => MutationObserver;
  private observer: MutationObserver | null = null;
  private root: Element | null = null;
  private paused = false;

  public constructor(options: DomObserverOptions) {
    this.eventBus = options.eventBus;
    this.ignoreSelectors = options.ignoreSelectors ?? [];
    this.now = options.now ?? Date.now;
    this.observerFactory = options.observerFactory ?? ((callback) => new MutationObserver(callback));
  }

  public start(root: Element): void {
    if (root === document.body) {
      throw new Error('DOMObserver v2 requires a scoped root, never document.body.');
    }
    this.stop();
    this.root = root;
    this.paused = false;
    this.observer = this.observerFactory((mutations) => this.handleMutations(mutations));
    this.observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  public stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.root = null;
    this.paused = false;
  }

  public pause(): void {
    this.paused = true;
  }

  public resume(): void {
    this.paused = false;
  }

  public isObserving(): boolean {
    return this.observer !== null;
  }

  public getRoot(): Element | null {
    return this.root;
  }

  private handleMutations(mutations: MutationRecord[]): void {
    if (this.paused || !this.root) return;

    const grouped = new Map<Node, MutationRecord[]>();
    for (const mutation of mutations) {
      for (const node of nodesForMutation(mutation)) {
        if (this.shouldIgnore(node)) continue;
        const records = grouped.get(node) ?? [];
        records.push(mutation);
        grouped.set(node, records);
      }
    }

    const timestamp = this.now();
    for (const [node, records] of grouped) {
      this.eventBus.emit('dom:mutation', { node, mutations: Object.freeze(records), timestamp });
    }
  }

  private shouldIgnore(node: Node): boolean {
    const element = toElement(node);
    if (!element) return false;
    if (element.matches('script, style, link, [data-aamp-owned="true"]')) return true;
    if (element.closest('[data-aamp-owned="true"]')) return true;
    return this.ignoreSelectors.some((selector) => element.matches(selector) || Boolean(element.closest(selector)));
  }
}

/** Finds a narrow Arena application root without ever falling back to body. */
export function findArenaRoot(documentRef: Document): Element | null {
  return documentRef.querySelector('main, [role="main"], #main-content');
}

function nodesForMutation(mutation: MutationRecord): Node[] {
  if (mutation.type === 'childList' && mutation.addedNodes.length > 0) return Array.from(mutation.addedNodes);
  if (mutation.type === 'characterData') return [mutation.target.parentElement ?? mutation.target];
  return [mutation.target];
}

function toElement(node: Node): Element | null {
  if (node.nodeType === Node.ELEMENT_NODE) return node as Element;
  return node.parentElement;
}
