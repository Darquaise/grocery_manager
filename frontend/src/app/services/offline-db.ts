import { Injectable } from '@angular/core';

/**
 * Thin IndexedDB wrapper: a `cache` store (one entry per data type) for
 * offline reads, and an `outbox` store (FIFO) for writes made while offline.
 * The server stays the source of truth; everything here is a disposable cache.
 */
const DB_NAME = 'grocery';
const DB_VERSION = 1;
const CACHE_STORE = 'cache';
const OUTBOX_STORE = 'outbox';

export interface CacheEntry<T> {
  key: string;
  data: T;
  fetchedAt: number;
}

export type OutboxType =
  | 'shopping.toggle'
  | 'shopping.add'
  | 'shopping.remove'
  | 'stock.add'
  | 'stock.adjust'
  | 'stock.remove';

export interface OutboxOp {
  id?: number;
  type: OutboxType;
  payload: Record<string, unknown>;
  /** Server `updated_at` last seen by the client — for conflict detection. */
  baseUpdatedAt?: string | null;
  createdAt: number;
}

@Injectable({ providedIn: 'root' })
export class OfflineDbService {
  private dbPromise?: Promise<IDBDatabase>;

  private open(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(CACHE_STORE)) {
            db.createObjectStore(CACHE_STORE, { keyPath: 'key' });
          }
          if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
            db.createObjectStore(OUTBOX_STORE, { keyPath: 'id', autoIncrement: true });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this.dbPromise;
  }

  private run<T>(
    store: string,
    mode: IDBTransactionMode,
    fn: (s: IDBObjectStore) => IDBRequest,
  ): Promise<T> {
    return this.open().then(
      (db) =>
        new Promise<T>((resolve, reject) => {
          const tx = db.transaction(store, mode);
          const req = fn(tx.objectStore(store));
          req.onsuccess = () => resolve(req.result as T);
          req.onerror = () => reject(req.error);
        }),
    );
  }

  // ── cache (offline reads) ───────────────────────────────────────────────────

  async getCache<T>(key: string): Promise<CacheEntry<T> | undefined> {
    try {
      return await this.run<CacheEntry<T> | undefined>(CACHE_STORE, 'readonly', (s) => s.get(key));
    } catch {
      return undefined;
    }
  }

  async setCache<T>(key: string, data: T): Promise<void> {
    try {
      await this.run(CACHE_STORE, 'readwrite', (s) => s.put({ key, data, fetchedAt: Date.now() }));
    } catch {
      /* cache writes are best-effort */
    }
  }

  // ── outbox (offline writes) ─────────────────────────────────────────────────

  async addOp(op: Omit<OutboxOp, 'id'>): Promise<number> {
    return this.run<number>(OUTBOX_STORE, 'readwrite', (s) => s.add(op));
  }

  async allOps(): Promise<OutboxOp[]> {
    try {
      return await this.run<OutboxOp[]>(OUTBOX_STORE, 'readonly', (s) => s.getAll());
    } catch {
      return [];
    }
  }

  async putOp(op: OutboxOp): Promise<void> {
    try {
      await this.run(OUTBOX_STORE, 'readwrite', (s) => s.put(op));
    } catch {
      /* best-effort */
    }
  }

  async deleteOp(id: number): Promise<void> {
    try {
      await this.run(OUTBOX_STORE, 'readwrite', (s) => s.delete(id));
    } catch {
      /* best-effort */
    }
  }
}
