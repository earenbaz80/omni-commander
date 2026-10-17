/**
 * HandleStore — IndexedDB-backed storage for File System Access API handles.
 * Extracted from fileSystem.ts to keep the main engine file focused.
 */
export class HandleStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private getDatabase(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open('nc_filesystem_handles_v1', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('handles')) {
          db.createObjectStore('handles');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.dbPromise;
  }

  public async get(id: string): Promise<any> {
    const db = await this.getDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('handles', 'readonly');
      const store = tx.objectStore('handles');
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  public async set(id: string, value: any): Promise<void> {
    const db = await this.getDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('handles', 'readwrite');
      const store = tx.objectStore('handles');
      const req = store.put(value, id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}

export const handleStore = typeof window === 'undefined' ? null as any : new HandleStore();