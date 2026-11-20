import { z } from 'zod';

export const PROMPT_SCHEMA_VERSION = 'v2';

export const ReactivityModeSchema = z.enum(['dynamic', 'location_only', 'manual']);
export type ReactivityMode = z.infer<typeof ReactivityModeSchema>;

export const AspectRatioSchema = z.enum(['16:9', '4:3', '1:1']);
export type AspectRatio = z.infer<typeof AspectRatioSchema>;

export const QualityTierSchema = z.enum(['fast', 'balanced', 'high']);
export type QualityTier = z.infer<typeof QualityTierSchema>;

export const TurnPayloadSchema = z.object({
  turnIndex: z.number().int().min(0),
  command: z.string().max(500),
  statusBarRoomTitle: z.string().max(200).nullable(),
  narrativeDelta: z.string().max(12000),
  vmLocationId: z.number().int().optional(),
});
export type TurnPayload = z.infer<typeof TurnPayloadSchema>;

export const RoomMemoryInputSchema = z.object({
  previousLocationKey: z.string().max(200).nullable(),
  knownBaseDescription: z.string().max(8000).nullable(),
  previousStateTags: z.array(z.string().max(100)).max(32).default([]),
  carriedLightSource: z.string().max(120).nullable().optional(),
});
export type RoomMemoryInput = z.infer<typeof RoomMemoryInputSchema>;

export const SceneProcessRequestSchema = z.object({
  sessionId: z.string().min(1).max(128),
  storyId: z.string().min(1).max(128),
  storyTitle: z.string().max(200).optional(),
  stylePresetId: z.string().min(1).max(64),
  customStylePrompt: z.string().max(500).optional(),
  reactivityMode: z.enum(['dynamic', 'location_only']).default('location_only'),
  aspectRatio: AspectRatioSchema.default('16:9'),
  quality: QualityTierSchema.default('fast'),
  forceGenerate: z.boolean().optional(),
  turn: TurnPayloadSchema,
  roomMemory: RoomMemoryInputSchema,
});
export type SceneProcessRequest = z.infer<typeof SceneProcessRequestSchema>;

export const MapHintsSchema = z.object({
  movementDirection: z.string().max(32).nullable().optional(),
  mentionedExits: z.array(z.string().max(32)).max(16).default([]),
  isOneWaySuspected: z.boolean().optional(),
});
export type MapHints = z.infer<typeof MapHintsSchema>;

export const SceneDirectorOutputSchema = z.object({
  shouldGenerate: z.boolean(),
  changeType: z.enum(['new_location', 'major_state_change', 'darkness', 'no_visual_change']),
  locationKey: z.string().min(1).max(160),
  displayTitle: z.string().min(1).max(200),
  updatedBaseDescription: z.string().max(4000),
  stateTags: z.array(z.string().max(80)).max(24).default([]),
  imagePrompt: z.string().max(2500),
  negativePrompt: z.string().max(800).default(''),
  paletteHint: z.string().max(32).optional(),
  mapHints: MapHintsSchema.optional(),
});
export type SceneDirectorOutput = z.infer<typeof SceneDirectorOutputSchema>;

export const SceneAssetMetadataSchema = z.object({
  cacheKey: z.string(),
  imageUrl: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  provider: z.string(),
  model: z.string(),
  variationIndex: z.number().int().min(0),
  totalVariations: z.number().int().min(1),
  promptUsed: z.string(),
  locationKey: z.string(),
  displayTitle: z.string(),
  stateTags: z.array(z.string()),
  paletteHint: z.string().optional(),
  cacheHit: z.boolean(),
  latencyMs: z.number().int().optional(),
});
export type SceneAssetMetadata = z.infer<typeof SceneAssetMetadataSchema>;

export const SceneProcessResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('skipped'),
    reason: z.string(),
    director: SceneDirectorOutputSchema,
  }),
  z.object({
    status: z.literal('hit'),
    director: SceneDirectorOutputSchema,
    asset: SceneAssetMetadataSchema,
  }),
  z.object({
    status: z.literal('generating'),
    jobId: z.string(),
    streamUrl: z.string(),
    cacheKey: z.string(),
    director: SceneDirectorOutputSchema,
  }),
]);
export type SceneProcessResponse = z.infer<typeof SceneProcessResponseSchema>;

export const SceneJobEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('status'),
    jobId: z.string(),
    stage: z.enum(['analyzing', 'generating', 'saving']),
    message: z.string(),
  }),
  z.object({
    type: z.literal('completed'),
    jobId: z.string(),
    asset: SceneAssetMetadataSchema,
  }),
  z.object({
    type: z.literal('failed'),
    jobId: z.string(),
    error: z.string(),
    code: z.enum([
      'provider_error',
      'quota_exceeded',
      'safety_filtered',
      'budget_exceeded',
      'cancelled',
    ]),
  }),
]);
export type SceneJobEvent = z.infer<typeof SceneJobEventSchema>;

export const RegenerateSceneRequestSchema = z.object({
  sessionId: z.string().min(1).max(128),
  storyId: z.string().min(1).max(128),
  stylePresetId: z.string().min(1).max(64),
  customStylePrompt: z.string().max(500).optional(),
  aspectRatio: AspectRatioSchema.default('16:9'),
  quality: QualityTierSchema.default('fast'),
  locationKey: z.string().min(1).max(160),
  displayTitle: z.string().min(1).max(200),
  stateTags: z.array(z.string().max(80)).max(24).default([]),
  imagePrompt: z.string().min(1).max(2500),
  negativePrompt: z.string().max(800).optional(),
  paletteHint: z.string().max(32).optional(),
});
export type RegenerateSceneRequest = z.infer<typeof RegenerateSceneRequestSchema>;

export const CatalogEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  author: z.string(),
  year: z.number().int(),
  format: z.string(),
  difficulty: z.enum(['Introductory', 'Classic', 'Challenging']),
  description: z.string(),
  recommendedStyle: z.string(),
  url: z.string().url(),
});
export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;

export function normalizeLocationKey(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
  return cleaned || 'unknown_location';
}

export function canonicalizeStateTags(tags: string[]): string[] {
  const unique = new Set(
    tags
      .map((t) =>
        t
          .trim()
          .toLowerCase()
          .replace(/\s+/g, '_')
          .replace(/[^a-z0-9:_-]/g, ''),
      )
      .filter(Boolean),
  );
  return Array.from(unique).sort();
}
