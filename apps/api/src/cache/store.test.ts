import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SceneCacheStore, computeSceneCacheKey } from './store.js';

describe('SceneCacheStore', () => {
  const tempDirs: string[] = [];

  function createTempStore(): SceneCacheStore {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zorkaliser-cache-test-'));
    tempDirs.push(dir);
    return new SceneCacheStore(dir);
  }

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('computes identical cache keys regardless of stateTag order or casing', () => {
    const keyA = computeSceneCacheKey({
      storyId: 'story-1',
      stylePresetId: 'cyberpunk',
      locationKey: 'kitchen',
      stateTags: ['Window:Open', 'lantern:lit'],
      aspectRatio: '16:9',
      quality: 'fast',
    });
    const keyB = computeSceneCacheKey({
      storyId: 'story-1',
      stylePresetId: 'cyberpunk',
      locationKey: 'kitchen',
      stateTags: ['lantern:lit', 'window:open', 'window:open'],
      aspectRatio: '16:9',
      quality: 'fast',
    });

    expect(keyA).toBe(keyB);
  });

  it('stores, retrieves, increments hit count, and tracks variations', () => {
    const store = createTempStore();
    const cacheKey = computeSceneCacheKey({
      storyId: 'story-1',
      stylePresetId: 'fantasy-oil',
      locationKey: 'west_of_house',
      stateTags: ['mailbox:open'],
      aspectRatio: '16:9',
      quality: 'fast',
    });

    expect(store.getLatestVariation(cacheKey)).toBeNull();
    expect(store.getNextVariationIndex(cacheKey)).toBe(0);

    const v0 = store.saveScene({
      cacheKey,
      variationIndex: 0,
      storyId: 'story-1',
      styleKey: 'fantasy-oil',
      locationKey: 'west_of_house',
      stateTags: ['mailbox:open'],
      displayTitle: 'West of House',
      promptUsed: 'A white house in an open field',
      provider: 'mock',
      model: 'procedural-svg-v1',
      imageBytes: Buffer.from('<svg></svg>'),
      mimeType: 'image/svg+xml',
      width: 1280,
      height: 720,
    });

    expect(v0.totalVariations).toBe(1);
    const hit = store.getLatestVariation(cacheKey);
    expect(hit).not.toBeNull();
    expect(hit!.record.hitCount).toBe(1);
    expect(store.readAsset(hit!.record.assetFilename)?.bytes.toString()).toBe('<svg></svg>');

    // Path traversal blocked
    expect(store.readAsset('../zorkaliser.sqlite')).toBeNull();

    // Second variation increments cleanly
    expect(store.getNextVariationIndex(cacheKey)).toBe(1);
    const v1 = store.saveScene({
      cacheKey,
      variationIndex: 1,
      storyId: 'story-1',
      styleKey: 'fantasy-oil',
      locationKey: 'west_of_house',
      stateTags: ['mailbox:open'],
      displayTitle: 'West of House',
      promptUsed: 'A white house in an open field v2',
      provider: 'mock',
      model: 'procedural-svg-v1',
      imageBytes: Buffer.from('<svg>v2</svg>'),
      mimeType: 'image/svg+xml',
      width: 1280,
      height: 720,
    });
    expect(v1.totalVariations).toBe(2);
    expect(store.getLatestVariation(cacheKey)?.record.variationIndex).toBe(1);

    // Cost accounting
    store.logGeneration({
      sessionId: 's1',
      storyId: 'story-1',
      cacheHit: false,
      imageProvider: 'gemini',
      estimatedCost: 0.039,
      status: 'ok',
    });
    expect(store.getTodayEstimatedCostUsd()).toBeCloseTo(0.039, 4);

    store.close();
  });
});
