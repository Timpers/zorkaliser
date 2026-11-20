import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  PROMPT_SCHEMA_VERSION,
  canonicalizeStateTags,
  type AspectRatio,
  type QualityTier,
} from '@zorkaliser/shared';

export interface CacheKeyInput {
  storyId: string;
  stylePresetId: string;
  customStylePrompt?: string;
  locationKey: string;
  stateTags: string[];
  aspectRatio: AspectRatio;
  quality: QualityTier;
}

export interface CachedSceneRecord {
  cacheKey: string;
  variationIndex: number;
  storyId: string;
  styleKey: string;
  locationKey: string;
  stateTags: string[];
  displayTitle: string;
  promptUsed: string;
  provider: string;
  model: string;
  assetFilename: string;
  mimeType: string;
  width: number;
  height: number;
  paletteHint?: string;
  hitCount: number;
  createdAt: string;
}

export interface SaveSceneInput {
  cacheKey: string;
  variationIndex: number;
  storyId: string;
  styleKey: string;
  locationKey: string;
  stateTags: string[];
  displayTitle: string;
  promptUsed: string;
  provider: string;
  model: string;
  imageBytes: Buffer;
  mimeType: string;
  width: number;
  height: number;
  paletteHint?: string;
}

export interface GenerationLogInput {
  sessionId: string;
  storyId: string;
  cacheHit: boolean;
  llmProvider?: string;
  imageProvider?: string;
  latencyMs?: number;
  estimatedCost?: number;
  status: 'ok' | 'filtered' | 'error';
}

export function computeStyleKey(stylePresetId: string, customStylePrompt?: string): string {
  if (stylePresetId !== 'custom') {
    return stylePresetId;
  }
  const hash = crypto
    .createHash('sha256')
    .update((customStylePrompt ?? '').trim().toLowerCase())
    .digest('hex')
    .slice(0, 16);
  return `custom:${hash}`;
}

export function computeSceneCacheKey(input: CacheKeyInput): string {
  const styleKey = computeStyleKey(input.stylePresetId, input.customStylePrompt);
  const canonicalTags = canonicalizeStateTags(input.stateTags).join(',');
  const raw = [
    input.storyId,
    styleKey,
    input.locationKey,
    canonicalTags,
    input.aspectRatio,
    input.quality,
    PROMPT_SCHEMA_VERSION,
  ].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function extensionForMime(mimeType: string): string {
  switch (mimeType) {
    case 'image/webp':
      return 'webp';
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/svg+xml':
      return 'svg';
    default:
      return 'png';
  }
}

export class SceneCacheStore {
  private readonly db: DatabaseSync;
  private readonly assetsDir: string;

  constructor(dataDir: string, dbFilename = 'zorkaliser.sqlite') {
    fs.mkdirSync(dataDir, { recursive: true });
    this.assetsDir = path.join(dataDir, 'assets');
    fs.mkdirSync(this.assetsDir, { recursive: true });

    const dbPath = dbFilename === ':memory:' ? ':memory:' : path.join(dataDir, dbFilename);
    this.db = new DatabaseSync(dbPath);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cached_scenes (
        cache_key        TEXT NOT NULL,
        variation_index  INTEGER NOT NULL DEFAULT 0,
        story_id         TEXT NOT NULL,
        style_key        TEXT NOT NULL,
        location_key     TEXT NOT NULL,
        state_tags_json  TEXT NOT NULL,
        display_title    TEXT NOT NULL,
        prompt_used      TEXT NOT NULL,
        provider         TEXT NOT NULL,
        model            TEXT NOT NULL,
        asset_filename   TEXT NOT NULL,
        mime_type        TEXT NOT NULL,
        width            INTEGER NOT NULL,
        height           INTEGER NOT NULL,
        palette_hint     TEXT,
        hit_count        INTEGER NOT NULL DEFAULT 0,
        created_at       TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (cache_key, variation_index)
      );

      CREATE INDEX IF NOT EXISTS idx_cached_scenes_lookup
        ON cached_scenes (story_id, style_key, location_key);

      CREATE TABLE IF NOT EXISTS generation_logs (
        id               TEXT PRIMARY KEY,
        session_id       TEXT NOT NULL,
        story_id         TEXT NOT NULL,
        cache_hit        INTEGER NOT NULL,
        llm_provider     TEXT,
        image_provider   TEXT,
        latency_ms       INTEGER,
        estimated_cost   REAL NOT NULL DEFAULT 0,
        status           TEXT NOT NULL,
        created_at       TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_generation_logs_date
        ON generation_logs (created_at);
    `);
  }

  getLatestVariation(cacheKey: string): { record: CachedSceneRecord; totalVariations: number } | null {
    const countRow = this.db
      .prepare('SELECT COUNT(*) as cnt FROM cached_scenes WHERE cache_key = ?')
      .get(cacheKey) as { cnt: number } | undefined;
    const total = Number(countRow?.cnt ?? 0);
    if (total === 0) return null;

    const row = this.db
      .prepare(
        `SELECT * FROM cached_scenes
         WHERE cache_key = ?
         ORDER BY variation_index DESC
         LIMIT 1`,
      )
      .get(cacheKey) as Record<string, unknown> | undefined;

    if (!row) return null;

    this.db
      .prepare(
        'UPDATE cached_scenes SET hit_count = hit_count + 1 WHERE cache_key = ? AND variation_index = ?',
      )
      .run(cacheKey, Number(row.variation_index));

    return {
      record: this.mapRow(row, Number(row.hit_count) + 1),
      totalVariations: total,
    };
  }

  getNextVariationIndex(cacheKey: string): number {
    const row = this.db
      .prepare('SELECT MAX(variation_index) as maxIdx FROM cached_scenes WHERE cache_key = ?')
      .get(cacheKey) as { maxIdx: number | null } | undefined;
    return row?.maxIdx === null || row?.maxIdx === undefined ? 0 : Number(row.maxIdx) + 1;
  }

  saveScene(input: SaveSceneInput): { record: CachedSceneRecord; totalVariations: number } {
    const ext = extensionForMime(input.mimeType);
    const assetFilename = `${input.cacheKey.slice(0, 20)}_v${input.variationIndex}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
    const fullPath = path.join(this.assetsDir, assetFilename);
    fs.writeFileSync(fullPath, input.imageBytes);

    this.db
      .prepare(
        `INSERT OR REPLACE INTO cached_scenes (
          cache_key, variation_index, story_id, style_key, location_key,
          state_tags_json, display_title, prompt_used, provider, model,
          asset_filename, mime_type, width, height, palette_hint, hit_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      )
      .run(
        input.cacheKey,
        input.variationIndex,
        input.storyId,
        input.styleKey,
        input.locationKey,
        JSON.stringify(canonicalizeStateTags(input.stateTags)),
        input.displayTitle,
        input.promptUsed,
        input.provider,
        input.model,
        assetFilename,
        input.mimeType,
        input.width,
        input.height,
        input.paletteHint ?? null,
      );

    const countRow = this.db
      .prepare('SELECT COUNT(*) as cnt FROM cached_scenes WHERE cache_key = ?')
      .get(input.cacheKey) as { cnt: number };

    const savedRow = this.db
      .prepare('SELECT * FROM cached_scenes WHERE cache_key = ? AND variation_index = ?')
      .get(input.cacheKey, input.variationIndex) as Record<string, unknown>;

    return {
      record: this.mapRow(savedRow),
      totalVariations: Number(countRow.cnt),
    };
  }

  readAsset(filename: string): { bytes: Buffer; mimeType: string } | null {
    // Prevent directory traversal
    const safeName = path.basename(filename);
    if (safeName !== filename || !/^[a-zA-Z0-9._-]+$/.test(safeName)) {
      return null;
    }
    const fullPath = path.join(this.assetsDir, safeName);
    if (!fs.existsSync(fullPath)) {
      return null;
    }
    const ext = path.extname(safeName).toLowerCase();
    const mimeType =
      ext === '.webp'
        ? 'image/webp'
        : ext === '.jpg' || ext === '.jpeg'
          ? 'image/jpeg'
          : ext === '.svg'
            ? 'image/svg+xml'
            : 'image/png';
    return { bytes: fs.readFileSync(fullPath), mimeType };
  }

  logGeneration(input: GenerationLogInput): void {
    this.db
      .prepare(
        `INSERT INTO generation_logs (
          id, session_id, story_id, cache_hit, llm_provider,
          image_provider, latency_ms, estimated_cost, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        crypto.randomUUID(),
        input.sessionId,
        input.storyId,
        input.cacheHit ? 1 : 0,
        input.llmProvider ?? null,
        input.imageProvider ?? null,
        input.latencyMs ?? null,
        input.estimatedCost ?? 0,
        input.status,
      );
  }

  getTodayEstimatedCostUsd(): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(estimated_cost), 0) as total
         FROM generation_logs
         WHERE created_at >= date('now')`,
      )
      .get() as { total: number } | undefined;
    return Number(row?.total ?? 0);
  }

  close(): void {
    this.db.close();
  }

  private mapRow(row: Record<string, unknown>, hitOverride?: number): CachedSceneRecord {
    return {
      cacheKey: String(row.cache_key),
      variationIndex: Number(row.variation_index),
      storyId: String(row.story_id),
      styleKey: String(row.style_key),
      locationKey: String(row.location_key),
      stateTags: JSON.parse(String(row.state_tags_json)) as string[],
      displayTitle: String(row.display_title),
      promptUsed: String(row.prompt_used),
      provider: String(row.provider),
      model: String(row.model),
      assetFilename: String(row.asset_filename),
      mimeType: String(row.mime_type),
      width: Number(row.width),
      height: Number(row.height),
      paletteHint: row.palette_hint ? String(row.palette_hint) : undefined,
      hitCount: hitOverride ?? Number(row.hit_count),
      createdAt: String(row.created_at),
    };
  }
}
