import type { FastifyInstance } from 'fastify';
import {
  RegenerateSceneRequestSchema,
  SceneProcessRequestSchema,
  type SceneAssetMetadata,
  type SceneProcessResponse,
} from '@zorkaliser/shared';
import type { AppConfig } from '../config.js';
import {
  computeSceneCacheKey,
  computeStyleKey,
  type CachedSceneRecord,
  type SceneCacheStore,
} from '../cache/store.js';
import type { SceneDirector } from '../director/sceneDirector.js';
import type { SceneJobManager } from '../jobs/jobManager.js';
import {
  ProviderQuotaError,
  SafetyFilterError,
  type ImageOrchestrator,
} from '../providers/imageProviders.js';

export interface SceneRouteDeps {
  config: AppConfig;
  cache: SceneCacheStore;
  director: SceneDirector;
  orchestrator: ImageOrchestrator;
  jobs: SceneJobManager;
}

function toAssetMetadata(
  record: CachedSceneRecord,
  totalVariations: number,
  cacheHit: boolean,
  latencyMs?: number,
): SceneAssetMetadata {
  return {
    cacheKey: record.cacheKey,
    imageUrl: `/api/assets/${encodeURIComponent(record.assetFilename)}`,
    width: record.width,
    height: record.height,
    provider: record.provider,
    model: record.model,
    variationIndex: record.variationIndex,
    totalVariations,
    promptUsed: record.promptUsed,
    locationKey: record.locationKey,
    displayTitle: record.displayTitle,
    stateTags: record.stateTags,
    paletteHint: record.paletteHint,
    cacheHit,
    latencyMs,
  };
}

export async function registerSceneRoutes(
  app: FastifyInstance,
  deps: SceneRouteDeps,
): Promise<void> {
  app.post('/api/scenes/process', async (request, reply) => {
    const parsed = SceneProcessRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid scene process payload',
        details: parsed.error.flatten(),
      });
    }

    const req = parsed.data;
    const directorOutput = await deps.director.analyze(req);

    if (!directorOutput.shouldGenerate) {
      const response: SceneProcessResponse = {
        status: 'skipped',
        reason: directorOutput.changeType,
        director: directorOutput,
      };
      return reply.status(200).send(response);
    }

    const cacheKey = computeSceneCacheKey({
      storyId: req.storyId,
      stylePresetId: req.stylePresetId,
      customStylePrompt: req.customStylePrompt,
      locationKey: directorOutput.locationKey,
      stateTags: directorOutput.stateTags,
      aspectRatio: req.aspectRatio,
      quality: req.quality,
    });

    const cached = deps.cache.getLatestVariation(cacheKey);
    if (cached && !req.forceGenerate) {
      deps.cache.logGeneration({
        sessionId: req.sessionId,
        storyId: req.storyId,
        cacheHit: true,
        llmProvider: deps.director.id,
        imageProvider: cached.record.provider,
        latencyMs: 0,
        estimatedCost: 0,
        status: 'ok',
      });

      const response: SceneProcessResponse = {
        status: 'hit',
        director: directorOutput,
        asset: toAssetMetadata(cached.record, cached.totalVariations, true, 0),
      };
      return reply.status(200).send(response);
    }

    // Check daily budget circuit breaker before launching paid generation
    const todayCost = deps.cache.getTodayEstimatedCostUsd();
    const isFreeLocalProvider =
      deps.orchestrator.primaryProviderId === 'mock' ||
      deps.orchestrator.primaryProviderId === 'lemonade';
    if (
      !isFreeLocalProvider &&
      deps.config.DAILY_COST_CAP_USD > 0 &&
      todayCost >= deps.config.DAILY_COST_CAP_USD
    ) {
      return reply.status(429).send({
        error: 'Daily image generation budget cap reached. Cached scenes remain available.',
        code: 'budget_exceeded',
      });
    }

    const styleKey = computeStyleKey(req.stylePresetId, req.customStylePrompt);
    const variationIndex = cached ? deps.cache.getNextVariationIndex(cacheKey) : 0;

    const jobId = deps.jobs.createJob(async (emit, signal) => {
      emit({
        type: 'status',
        jobId: '',
        stage: 'generating',
        message: `Illustrating ${directorOutput.displayTitle}...`,
      });

      try {
        const result = await deps.orchestrator.generate(
          {
            prompt: directorOutput.imagePrompt,
            negativePrompt: directorOutput.negativePrompt,
            aspectRatio: req.aspectRatio,
            quality: req.quality,
            stylePresetId: req.stylePresetId,
            displayTitle: directorOutput.displayTitle,
            stateTags: directorOutput.stateTags,
            seed: Math.floor(Math.random() * 2_147_483_647),
          },
          signal,
        );

        emit({
          type: 'status',
          jobId: '',
          stage: 'saving',
          message: 'Caching scene artwork...',
        });

        const saved = deps.cache.saveScene({
          cacheKey,
          variationIndex,
          storyId: req.storyId,
          styleKey,
          locationKey: directorOutput.locationKey,
          stateTags: directorOutput.stateTags,
          displayTitle: directorOutput.displayTitle,
          promptUsed: directorOutput.imagePrompt,
          provider: result.provider,
          model: result.model,
          imageBytes: result.imageBytes,
          mimeType: result.mimeType,
          width: result.width,
          height: result.height,
          paletteHint: directorOutput.paletteHint,
        });

        deps.cache.logGeneration({
          sessionId: req.sessionId,
          storyId: req.storyId,
          cacheHit: false,
          llmProvider: deps.director.id,
          imageProvider: result.provider,
          latencyMs: result.latencyMs,
          estimatedCost: result.estimatedCostUsd,
          status: 'ok',
        });

        emit({
          type: 'completed',
          jobId: '',
          asset: toAssetMetadata(saved.record, saved.totalVariations, false, result.latencyMs),
        });
      } catch (err) {
        const isSafety = err instanceof SafetyFilterError;
        const isQuota = err instanceof ProviderQuotaError;
        deps.cache.logGeneration({
          sessionId: req.sessionId,
          storyId: req.storyId,
          cacheHit: false,
          llmProvider: deps.director.id,
          imageProvider: deps.orchestrator.primaryProviderId,
          status: isSafety ? 'filtered' : 'error',
        });

        emit({
          type: 'failed',
          jobId: '',
          error: err instanceof Error ? err.message : 'Image generation failed',
          code: signal.aborted
            ? 'cancelled'
            : isQuota
              ? 'quota_exceeded'
              : isSafety
                ? 'safety_filtered'
                : 'provider_error',
        });
      }
    });

    const response: SceneProcessResponse = {
      status: 'generating',
      jobId,
      streamUrl: `/api/scenes/jobs/${jobId}/events`,
      cacheKey,
      director: directorOutput,
    };
    return reply.status(202).send(response);
  });

  app.post('/api/scenes/regenerate', async (request, reply) => {
    const parsed = RegenerateSceneRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid regenerate request',
        details: parsed.error.flatten(),
      });
    }

    const req = parsed.data;
    const todayCost = deps.cache.getTodayEstimatedCostUsd();
    const isFreeLocalProvider =
      deps.orchestrator.primaryProviderId === 'mock' ||
      deps.orchestrator.primaryProviderId === 'lemonade';
    if (
      !isFreeLocalProvider &&
      deps.config.DAILY_COST_CAP_USD > 0 &&
      todayCost >= deps.config.DAILY_COST_CAP_USD
    ) {
      return reply.status(429).send({
        error: 'Daily image generation budget cap reached.',
        code: 'budget_exceeded',
      });
    }

    const cacheKey = computeSceneCacheKey({
      storyId: req.storyId,
      stylePresetId: req.stylePresetId,
      customStylePrompt: req.customStylePrompt,
      locationKey: req.locationKey,
      stateTags: req.stateTags,
      aspectRatio: req.aspectRatio,
      quality: req.quality,
    });
    const styleKey = computeStyleKey(req.stylePresetId, req.customStylePrompt);
    const variationIndex = deps.cache.getNextVariationIndex(cacheKey);

    const jobId = deps.jobs.createJob(async (emit, signal) => {
      emit({
        type: 'status',
        jobId: '',
        stage: 'generating',
        message: `Repainting ${req.displayTitle} (variation ${variationIndex + 1})...`,
      });

      try {
        const result = await deps.orchestrator.generate(
          {
            prompt: req.imagePrompt,
            negativePrompt: req.negativePrompt,
            aspectRatio: req.aspectRatio,
            quality: req.quality,
            stylePresetId: req.stylePresetId,
            displayTitle: req.displayTitle,
            stateTags: req.stateTags,
            seed: Math.floor(Math.random() * 2_147_483_647),
          },
          signal,
        );

        const saved = deps.cache.saveScene({
          cacheKey,
          variationIndex,
          storyId: req.storyId,
          styleKey,
          locationKey: req.locationKey,
          stateTags: req.stateTags,
          displayTitle: req.displayTitle,
          promptUsed: req.imagePrompt,
          provider: result.provider,
          model: result.model,
          imageBytes: result.imageBytes,
          mimeType: result.mimeType,
          width: result.width,
          height: result.height,
          paletteHint: req.paletteHint,
        });

        deps.cache.logGeneration({
          sessionId: req.sessionId,
          storyId: req.storyId,
          cacheHit: false,
          imageProvider: result.provider,
          latencyMs: result.latencyMs,
          estimatedCost: result.estimatedCostUsd,
          status: 'ok',
        });

        emit({
          type: 'completed',
          jobId: '',
          asset: toAssetMetadata(saved.record, saved.totalVariations, false, result.latencyMs),
        });
      } catch (err) {
        const isSafety = err instanceof SafetyFilterError;
        const isQuota = err instanceof ProviderQuotaError;
        emit({
          type: 'failed',
          jobId: '',
          error: err instanceof Error ? err.message : 'Regeneration failed',
          code: signal.aborted
            ? 'cancelled'
            : isQuota
              ? 'quota_exceeded'
              : isSafety
                ? 'safety_filtered'
                : 'provider_error',
        });
      }
    });

    return reply.status(202).send({
      status: 'generating',
      jobId,
      streamUrl: `/api/scenes/jobs/${jobId}/events`,
      cacheKey,
    });
  });

  app.get('/api/scenes/jobs/:jobId/events', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    if (!deps.jobs.hasJob(jobId)) {
      return reply.status(404).send({ error: 'Job not found' });
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': deps.config.CORS_ORIGIN,
    });

    const unsubscribe = deps.jobs.subscribe(jobId, (event) => {
      const enriched = { ...event, jobId };
      reply.raw.write(`data: ${JSON.stringify(enriched)}\n\n`);
      if (event.type === 'completed' || event.type === 'failed') {
        unsubscribe?.();
        reply.raw.end();
      }
    });

    request.raw.on('close', () => {
      unsubscribe?.();
    });
  });

  app.post('/api/scenes/jobs/:jobId/cancel', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const cancelled = deps.jobs.cancel(jobId);
    return reply.status(200).send({ cancelled });
  });

  app.get('/api/assets/:filename', async (request, reply) => {
    const { filename } = request.params as { filename: string };
    const asset = deps.cache.readAsset(filename);
    if (!asset) {
      return reply.status(404).send({ error: 'Asset not found' });
    }
    return reply
      .header('Content-Type', asset.mimeType)
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .send(asset.bytes);
  });
}
