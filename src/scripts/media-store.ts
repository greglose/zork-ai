// IndexedDB store for generated pictures and videos, keyed by game + style + kind + id. Never the Cache API.
// Every method resolves (never throws), including when IndexedDB is missing or blocked.
import type { GameId } from '../lib/if/types';

export interface MediaKey {
  game: GameId;
  /** The style id, plus a short hash of the player's description when there is one (see mediaNamespace). */
  styleId: string;
  kind: 'image' | 'video';
  id: string;
}

const DB_NAME = 'cls-if-media';
const STORE = 'media';

const keyString = (k: MediaKey) => `${k.game}|${k.styleId}|${k.kind}|${k.id}`;

function open(idb: IDBFactory): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = idb.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function request<T>(r: IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => resolve(null);
  });
}

export function createMediaStore(idb: IDBFactory) {
  const safe = async <T>(fallback: T, run: (db: IDBDatabase) => Promise<T>): Promise<T> => {
    try {
      if (!idb) return fallback;
      const db = await open(idb);
      if (!db) return fallback;
      try {
        return await run(db);
      } finally {
        db.close?.();
      }
    } catch {
      return fallback;
    }
  };

  return {
    get: (k: MediaKey): Promise<Blob | null> =>
      safe<Blob | null>(null, async (db) => {
        const v = await request(db.transaction(STORE, 'readonly').objectStore(STORE).get(keyString(k)));
        return v instanceof Blob ? v : null;
      }),

    put: (k: MediaKey, b: Blob): Promise<void> =>
      safe<void>(undefined, async (db) => {
        const tx = db.transaction(STORE, 'readwrite');
        const done = new Promise<void>((resolve) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
          tx.onabort = () => resolve();
        });
        tx.objectStore(STORE).put(b, keyString(k));
        await done;
      }),

    clear: (game: GameId): Promise<void> =>
      safe<void>(undefined, async (db) => {
        const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
        const keys = (await request(store.getAllKeys())) ?? [];
        for (const key of keys) {
          if (typeof key === 'string' && key.startsWith(`${game}|`)) await request(store.delete(key));
        }
      }),
  };
}
