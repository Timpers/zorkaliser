import type { GameMapGraph, SceneAssetMetadata } from '@zorkaliser/shared';
import type { StoredRoomMemory } from '../engine/turnObserver.js';

const DB_NAME = 'zorkaliser_db';
const DB_VERSION = 2;

export interface SavedSlotRecord {
  id: string; // `${storyId}:${slotName}`
  storyId: string;
  slotName: string;
  isAutosave: boolean;
  savedAt: number;
  roomTitle: string;
  stylePresetId: string;
  quetzalBytes: Uint8Array;
  roomMemory: StoredRoomMemory[];
  mapGraph?: GameMapGraph;
}

export interface LocalSceneCacheRecord {
  cacheKey: string;
  asset: SceneAssetMetadata;
  savedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('saves')) {
        const saves = db.createObjectStore('saves', { keyPath: 'id' });
        saves.createIndex('by_story', 'storyId', { unique: false });
      }
      if (!db.objectStoreNames.contains('sceneCache')) {
        db.createObjectStore('sceneCache', { keyPath: 'cacheKey' });
      }
      if (!db.objectStoreNames.contains('maps')) {
        db.createObjectStore('maps', { keyPath: 'storyId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed opening IndexedDB'));
  });
}

export async function putSaveSlot(record: SavedSlotRecord): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('saves', 'readwrite');
      tx.objectStore('saves').put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn('[storage] putSaveSlot failed:', err);
  }
}

export async function listSaveSlots(storyId: string): Promise<SavedSlotRecord[]> {
  try {
    const db = await openDb();
    const records = await new Promise<SavedSlotRecord[]>((resolve, reject) => {
      const tx = db.transaction('saves', 'readonly');
      const idx = tx.objectStore('saves').index('by_story');
      const req = idx.getAll(IDBKeyRange.only(storyId));
      req.onsuccess = () => resolve((req.result as SavedSlotRecord[]) ?? []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return records.sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

export async function deleteSaveSlot(id: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('saves', 'readwrite');
      tx.objectStore('saves').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // ignore
  }
}

export async function putL1SceneCache(asset: SceneAssetMetadata): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('sceneCache', 'readwrite');
      const rec: LocalSceneCacheRecord = {
        cacheKey: asset.cacheKey,
        asset,
        savedAt: Date.now(),
      };
      tx.objectStore('sceneCache').put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // ignore
  }
}

export async function getL1SceneCache(cacheKey: string): Promise<SceneAssetMetadata | null> {
  try {
    const db = await openDb();
    const rec = await new Promise<LocalSceneCacheRecord | undefined>((resolve, reject) => {
      const tx = db.transaction('sceneCache', 'readonly');
      const req = tx.objectStore('sceneCache').get(cacheKey);
      req.onsuccess = () => resolve(req.result as LocalSceneCacheRecord | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return rec?.asset ?? null;
  } catch {
    return null;
  }
}

export async function putSavedMap(graph: GameMapGraph): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('maps', 'readwrite');
      tx.objectStore('maps').put(graph);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // ignore
  }
}

export async function getSavedMap(storyId: string): Promise<GameMapGraph | null> {
  try {
    const db = await openDb();
    const rec = await new Promise<GameMapGraph | undefined>((resolve, reject) => {
      const tx = db.transaction('maps', 'readonly');
      const req = tx.objectStore('maps').get(storyId);
      req.onsuccess = () => resolve(req.result as GameMapGraph | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return rec ?? null;
  } catch {
    return null;
  }
}
