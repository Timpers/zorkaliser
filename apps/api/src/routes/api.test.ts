import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { isPrivateOrReservedIp, isValidZMachineOrBlorb } from './proxy.js';

describe('Zorkaliser API integration', () => {
  const tempDirs: string[] = [];

  async function buildTestApp() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zorkaliser-api-test-'));
    tempDirs.push(dir);
    const config = loadConfig({
      DATA_DIR: dir,
      LLM_PROVIDER: 'mock',
      IMAGE_PROVIDER: 'mock',
      GEMINI_API_KEY: '',
      OPENAI_API_KEY: '',
      FAL_KEY: '',
    });
    return createApp({ config, mockDelayMs: 5 });
  }

  afterEach(() => {
    while (tempDirs.length > 0) {
      fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  it('serves health, styles, and catalog endpoints', async () => {
    const { app } = await buildTestApp();
    try {
      const health = await app.inject({ method: 'GET', url: '/api/health' });
      expect(health.statusCode).toBe(200);
      expect(health.json().status).toBe('ok');
      expect(health.json().providers.image).toBe('mock');

      const styles = await app.inject({ method: 'GET', url: '/api/styles' });
      expect(styles.statusCode).toBe(200);
      expect(styles.json().styles.length).toBeGreaterThanOrEqual(7);

      const catalog = await app.inject({ method: 'GET', url: '/api/catalog' });
      expect(catalog.statusCode).toBe(200);
      expect(catalog.json().stories.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it('processes a new scene (202 -> SSE complete -> asset fetch -> 200 cache hit -> regenerate)', async () => {
    const { app } = await buildTestApp();
    try {
      const payload = {
        sessionId: 'sess-e2e',
        storyId: 'zork-hash-123',
        storyTitle: 'Zork I',
        stylePresetId: 'cyberpunk',
        reactivityMode: 'dynamic',
        aspectRatio: '16:9',
        quality: 'fast',
        turn: {
          turnIndex: 0,
          command: '',
          statusBarRoomTitle: 'West of House',
          narrativeDelta:
            'West of House\nYou are standing in an open field west of a white house, with a boarded front door.',
        },
        roomMemory: {
          previousLocationKey: null,
          knownBaseDescription: null,
          previousStateTags: [],
        },
      };

      // 1st request: Cache miss -> 202 generating
      const first = await app.inject({
        method: 'POST',
        url: '/api/scenes/process',
        payload,
      });
      expect(first.statusCode).toBe(202);
      const firstBody = first.json();
      expect(firstBody.status).toBe('generating');
      expect(firstBody.jobId).toBeTruthy();

      // Wait for async job completion via SSE endpoint
      const sse = await app.inject({
        method: 'GET',
        url: firstBody.streamUrl,
      });
      expect(sse.statusCode).toBe(200);
      expect(sse.body).toContain('"type":"completed"');

      // Extract completed asset URL from SSE payload
      const lines = sse.body
        .split('\n')
        .filter((l) => l.startsWith('data: '))
        .map((l) => JSON.parse(l.slice(6)));
      const completed = lines.find((e) => e.type === 'completed');
      expect(completed?.asset?.imageUrl).toMatch(/^\/api\/assets\//);

      // Fetch generated image asset
      const assetRes = await app.inject({
        method: 'GET',
        url: completed.asset.imageUrl,
      });
      expect(assetRes.statusCode).toBe(200);
      expect(assetRes.headers['content-type']).toBe('image/svg+xml');
      expect(assetRes.body).toContain('<svg');

      // 2nd identical request: Immediate 200 cache hit
      const second = await app.inject({
        method: 'POST',
        url: '/api/scenes/process',
        payload,
      });
      expect(second.statusCode).toBe(200);
      const secondBody = second.json();
      expect(secondBody.status).toBe('hit');
      expect(secondBody.asset.cacheHit).toBe(true);

      // Regenerate produces variationIndex 1
      const regen = await app.inject({
        method: 'POST',
        url: '/api/scenes/regenerate',
        payload: {
          sessionId: 'sess-e2e',
          storyId: 'zork-hash-123',
          stylePresetId: 'cyberpunk',
          aspectRatio: '16:9',
          quality: 'fast',
          locationKey: firstBody.director.locationKey,
          displayTitle: firstBody.director.displayTitle,
          stateTags: firstBody.director.stateTags,
          imagePrompt: firstBody.director.imagePrompt,
        },
      });
      expect(regen.statusCode).toBe(202);
      const regenSse = await app.inject({
        method: 'GET',
        url: regen.json().streamUrl,
      });
      expect(regenSse.body).toContain('"variationIndex":1');
      expect(regenSse.body).toContain('"totalVariations":2');
    } finally {
      await app.close();
    }
  });

  it('blocks SSRF attempts and non-allowlisted hosts on /api/proxy/story', async () => {
    const { app } = await buildTestApp();
    try {
      const loopback = await app.inject({
        method: 'POST',
        url: '/api/proxy/story',
        payload: { url: 'http://127.0.0.1:3001/api/health' },
      });
      expect(loopback.statusCode).toBe(400);

      const metadata = await app.inject({
        method: 'POST',
        url: '/api/proxy/story',
        payload: { url: 'https://169.254.169.254/latest/meta-data/' },
      });
      expect(metadata.statusCode).toBe(403);

      const arbitrary = await app.inject({
        method: 'POST',
        url: '/api/proxy/story',
        payload: { url: 'https://example.com/game.z5' },
      });
      expect(arbitrary.statusCode).toBe(403);

      expect(isPrivateOrReservedIp('127.0.0.1')).toBe(true);
      expect(isPrivateOrReservedIp('169.254.169.254')).toBe(true);
      expect(isPrivateOrReservedIp('10.0.0.5')).toBe(true);
      expect(isPrivateOrReservedIp('::1')).toBe(true);
      expect(isPrivateOrReservedIp('1.1.1.1')).toBe(false);

      // Magic byte validation
      const z5 = new Uint8Array(64);
      z5[0] = 5;
      expect(isValidZMachineOrBlorb(z5)).toBe(true);

      const html = new TextEncoder().encode('<html><body>Not a Z-machine file at all.........................................</body></html>');
      expect(isValidZMachineOrBlorb(html)).toBe(false);
    } finally {
      await app.close();
    }
  });
});
