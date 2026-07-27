import { EventBus } from '../../../src/core/event-bus';
import { DomObserverV2, findArenaRoot, type DomObserverEvents } from '../../../src/observability/dom-observer';

async function flushMutations(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('DOMObserver v2', () => {
  beforeEach(() => {
    document.body.innerHTML = '<main id="app-root"></main>';
  });

  it('observes only a supplied scoped root and emits structured added-node mutations', async () => {
    const events: unknown[] = [];
    const bus = new EventBus<DomObserverEvents>();
    bus.on('dom:mutation', (event) => events.push(event));
    const observer = new DomObserverV2({ eventBus: bus, now: () => 1_700_000_000_000 });
    const root = document.getElementById('app-root') as HTMLElement;

    observer.start(root);
    const message = document.createElement('article');
    message.textContent = 'new assistant response';
    root.append(message);
    await flushMutations();

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(expect.objectContaining({
      node: message,
      timestamp: 1_700_000_000_000,
      mutations: expect.any(Array),
    }));
    expect(observer.getRoot()).toBe(root);
    expect(observer.isObserving()).toBe(true);
  });

  it('ignores AAMP-owned and caller-ignored nodes without suppressing page mutations', async () => {
    const eventNodes: Node[] = [];
    const bus = new EventBus<DomObserverEvents>();
    bus.on('dom:mutation', ({ node }) => eventNodes.push(node));
    const observer = new DomObserverV2({ eventBus: bus, ignoreSelectors: ['.transient'] });
    const root = document.getElementById('app-root') as HTMLElement;
    observer.start(root);

    const owned = document.createElement('div');
    owned.dataset.aampOwned = 'true';
    const ignored = document.createElement('div');
    ignored.className = 'transient';
    const allowed = document.createElement('div');
    root.append(owned, ignored, allowed);
    await flushMutations();

    expect(eventNodes).toEqual([allowed]);
  });

  it('supports pause/resume, tears down cleanly, and refuses document.body', async () => {
    const bus = new EventBus<DomObserverEvents>();
    const handler = jest.fn();
    bus.on('dom:mutation', handler);
    const observer = new DomObserverV2({ eventBus: bus });
    const root = document.getElementById('app-root') as HTMLElement;

    expect(() => observer.start(document.body)).toThrow('scoped root');
    observer.start(root);
    observer.pause();
    root.append(document.createElement('div'));
    await flushMutations();
    expect(handler).not.toHaveBeenCalled();

    observer.resume();
    root.append(document.createElement('div'));
    await flushMutations();
    expect(handler).toHaveBeenCalledTimes(1);
    observer.stop();
    expect(observer.isObserving()).toBe(false);
    expect(observer.getRoot()).toBeNull();
  });

  it('discovers only the app root and returns null instead of body', () => {
    expect(findArenaRoot(document)).toBe(document.getElementById('app-root'));
    document.body.innerHTML = '<div>no scoped root</div>';
    expect(findArenaRoot(document)).toBeNull();
  });
  it('emits for text changes by attributing them to the containing element', async () => {
    const events: { node: Node }[] = [];
    const bus = new EventBus<DomObserverEvents>();
    bus.on('dom:mutation', (event) => events.push(event));
    const observer = new DomObserverV2({ eventBus: bus, now: () => 1_700_000_000_000 });
    const root = document.getElementById('app-root') as HTMLElement;
    const paragraph = document.createElement('p');
    paragraph.textContent = 'before';
    root.append(paragraph);

    observer.start(root);
    paragraph.firstChild!.textContent = 'after';
    await flushMutations();

    // A characterData mutation is attributed to its parent element, never
    // reported as a bare text node.
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.node.nodeType).toBe(Node.ELEMENT_NODE);
    observer.stop();
  });

  it('deliberately does not observe attribute changes', async () => {
    const events: { node: Node }[] = [];
    const bus = new EventBus<DomObserverEvents>();
    bus.on('dom:mutation', (event) => events.push(event));
    const observer = new DomObserverV2({ eventBus: bus, now: () => 1_700_000_000_000 });
    const root = document.getElementById('app-root') as HTMLElement;
    const button = document.createElement('button');
    root.append(button);

    observer.start(root);
    button.setAttribute('aria-busy', 'true');
    await flushMutations();

    // The observer subscribes to childList/subtree/characterData only. Arena
    // toggles attributes constantly, so watching them would flood the mutation
    // budget for no signal.
    expect(events).toHaveLength(0);
    observer.stop();
  });

  it('refuses document.body specifically, which is the dangerous root', () => {
    const observer = new DomObserverV2({ eventBus: new EventBus<DomObserverEvents>(), now: () => 1 });

    expect(() => observer.start(document.body)).toThrow(/never document.body/u);
    expect(observer.isObserving()).toBe(false);
    expect(observer.getRoot()).toBeNull();
  });

  it('replaces a previous root instead of observing both', async () => {
    const events: { node: Node }[] = [];
    const bus = new EventBus<DomObserverEvents>();
    bus.on('dom:mutation', (event) => events.push(event));
    const observer = new DomObserverV2({ eventBus: bus, now: () => 1 });

    document.body.innerHTML = '<main id="first"></main><section id="second"></section>';
    const first = document.getElementById('first') as HTMLElement;
    const second = document.getElementById('second') as HTMLElement;

    observer.start(first);
    observer.start(second);
    expect(observer.getRoot()).toBe(second);

    first.append(document.createElement('div'));
    await flushMutations();
    // The abandoned root must no longer produce events.
    expect(events).toHaveLength(0);

    second.append(document.createElement('div'));
    await flushMutations();
    expect(events.length).toBeGreaterThan(0);
    observer.stop();
  });

  it('stopping twice is safe and clears the root', () => {
    const observer = new DomObserverV2({ eventBus: new EventBus<DomObserverEvents>(), now: () => 1 });
    const root = document.getElementById('app-root') as HTMLElement;

    observer.start(root);
    expect(observer.isObserving()).toBe(true);
    observer.stop();
    expect(observer.getRoot()).toBeNull();
    expect(() => observer.stop()).not.toThrow();
  });

  it('finds each supported app root selector in priority order', () => {
    document.body.innerHTML = '<div role="main" id="by-role"></div>';
    expect(findArenaRoot(document)?.id).toBe('by-role');

    document.body.innerHTML = '<div id="main-content"></div>';
    expect(findArenaRoot(document)?.id).toBe('main-content');

    document.body.innerHTML = '<main id="by-tag"></main><div role="main" id="by-role"></div>';
    // `main` wins when several candidates are present.
    expect(findArenaRoot(document)?.id).toBe('by-tag');
  });
});
