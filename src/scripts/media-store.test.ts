import { describe, expect, it } from 'vitest';
import { createMediaStore, type MediaKey } from './media-store';

// Minimal in-memory IDBFactory: just the surface media-store uses (open/upgrade, get, put, delete, getAllKeys).
function fakeIdb(): IDBFactory {
  const dbs = new Map<string, Map<string, Map<string, unknown>>>();
  const req = <T>(run: () => T) => {
    const r: Record<string, unknown> = {};
    queueMicrotask(() => {
      try {
        r.result = run();
        (r.onsuccess as (() => void) | undefined)?.();
      } catch (e) {
        r.error = e;
        (r.onerror as (() => void) | undefined)?.();
      }
    });
    return r;
  };
  return {
    open(name: string) {
      const r: Record<string, unknown> = {};
      queueMicrotask(() => {
        const fresh = !dbs.has(name);
        if (fresh) dbs.set(name, new Map());
        const data = dbs.get(name)!;
        const db = {
          objectStoreNames: { contains: (n: string) => data.has(n) },
          createObjectStore: (n: string) => void data.set(n, new Map()),
          close() {},
          transaction(n: string) {
            const s = data.get(n)!;
            const tx: Record<string, unknown> = {
              objectStore: () => ({
                get: (k: string) => req(() => s.get(k)),
                put: (v: unknown, k: string) => {
                  const q = req(() => void s.set(k, v));
                  q.onsuccess = undefined;
                  queueMicrotask(() => queueMicrotask(() => (tx.oncomplete as (() => void) | undefined)?.()));
                  return q;
                },
                delete: (k: string) => req(() => void s.delete(k)),
                getAllKeys: () => req(() => [...s.keys()]),
              }),
            };
            return tx;
          },
        };
        r.result = db;
        if (fresh) (r.onupgradeneeded as (() => void) | undefined)?.();
        (r.onsuccess as (() => void) | undefined)?.();
      });
      return r as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;
}

const key: MediaKey = { game: 'zork', styleId: 'cartoon', kind: 'image', id: 'west-of-house' };

describe('media store', () => {
  it('put_then_get_roundtrips', async () => {
    const store = createMediaStore(fakeIdb());
    const blob = new Blob(['abc'], { type: 'image/png' });
    await store.put(key, blob);
    const got = await store.get(key);
    expect(got).not.toBeNull();
    expect(await got!.text()).toBe('abc');
  });

  it('different_style_is_a_different_entry', async () => {
    const store = createMediaStore(fakeIdb());
    await store.put(key, new Blob(['cartoon']));
    expect(await store.get({ ...key, styleId: 'photo' })).toBeNull();
    await store.put({ ...key, styleId: 'photo' }, new Blob(['photo']));
    expect(await (await store.get(key))!.text()).toBe('cartoon');
  });

  it('missing_returns_null', async () => {
    expect(await createMediaStore(fakeIdb()).get(key)).toBeNull();
  });

  it('clear_removes_only_that_game', async () => {
    const store = createMediaStore(fakeIdb());
    await store.put(key, new Blob(['z']));
    await store.put({ ...key, game: 'adventure' }, new Blob(['a']));
    await store.clear('zork');
    expect(await store.get(key)).toBeNull();
    expect(await store.get({ ...key, game: 'adventure' })).not.toBeNull();
  });

  it('unavailable_idb_get_returns_null_put_resolves', async () => {
    for (const idb of [undefined as unknown as IDBFactory, { open: () => { throw new Error('denied'); } } as unknown as IDBFactory]) {
      const store = createMediaStore(idb);
      expect(await store.get(key)).toBeNull();
      await expect(store.put(key, new Blob(['x']))).resolves.toBeUndefined();
      await expect(store.clear('zork')).resolves.toBeUndefined();
    }
  });
});
