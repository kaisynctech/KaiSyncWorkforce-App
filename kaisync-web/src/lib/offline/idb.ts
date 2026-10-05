/**
 * Small IndexedDB helper for the employee offline pack.
 * Store names: meta, job_pack, job_actions, blobs
 */

const DB_NAME = 'kaisync_employee_offline'
const DB_VERSION = 1

export type OfflineStore = 'meta' | 'job_pack' | 'job_actions' | 'blobs'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available on this device.'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta')
      if (!db.objectStoreNames.contains('job_pack')) db.createObjectStore('job_pack')
      if (!db.objectStoreNames.contains('job_actions')) {
        db.createObjectStore('job_actions', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Failed to open offline storage'))
  })
}

export async function idbGet<T>(store: OfflineStore, key: string): Promise<T | undefined> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly')
    const req = tx.objectStore(store).get(key)
    req.onsuccess = () => resolve(req.result as T | undefined)
    req.onerror = () => reject(req.error ?? new Error('Offline read failed'))
  })
}

export async function idbSet(store: OfflineStore, key: string, value: unknown): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Offline write failed'))
  })
}

export async function idbPut(store: 'job_actions', value: { id: string }): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).put(value)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Offline write failed'))
  })
}

export async function idbDelete(store: OfflineStore, key: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Offline delete failed'))
  })
}

export async function idbGetAll<T>(store: OfflineStore): Promise<T[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly')
    const req = tx.objectStore(store).getAll()
    req.onsuccess = () => resolve((req.result as T[]) ?? [])
    req.onerror = () => reject(req.error ?? new Error('Offline list failed'))
  })
}
