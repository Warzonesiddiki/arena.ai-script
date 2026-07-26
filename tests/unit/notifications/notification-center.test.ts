import { NotificationCenter } from '../../../src/notifications/notification-center';

describe('NotificationCenter', () => {
  it('applies verbosity, groups similar notifications, and invokes native fallback safely', async () => {
    let now = 0;
    const nativeApi = { create: jest.fn().mockResolvedValue('id') };
    const center = new NotificationCenter({ nativeApi, verbosity: 'important', groupWindowMs: 1_000, now: () => now, idFactory: () => 'n-1' });

    await expect(center.notify({ title: 'Info', message: 'hidden', severity: 'info' })).resolves.toBeNull();
    const first = await center.notify({ title: 'Bridge', message: 'reconnecting', severity: 'warning', groupKey: 'bridge' });
    now = 500;
    const grouped = await center.notify({ title: 'Bridge', message: 'still reconnecting', severity: 'warning', groupKey: 'bridge' });

    expect(first).toEqual(expect.objectContaining({ id: 'n-1', count: 1 }));
    expect(grouped).toEqual(expect.objectContaining({ id: 'n-1', count: 2 }));
    expect(center.getHistory()).toHaveLength(1);
    expect(nativeApi.create).toHaveBeenLastCalledWith('n-1', expect.objectContaining({ message: 'still reconnecting (2 similar events)' }));
  });

  it('supports error-only mode and rejects malformed notifications', async () => {
    const center = new NotificationCenter({ verbosity: 'errors' });
    await expect(center.notify({ title: 'Warning', message: 'skip', severity: 'warning' })).resolves.toBeNull();
    await expect(center.notify({ title: 'Error', message: 'show', severity: 'error' })).resolves.toEqual(expect.objectContaining({ severity: 'error' }));
    await expect(center.notify({ title: '', message: 'bad', severity: 'error' })).rejects.toThrow(TypeError);
  });
});
