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
});
