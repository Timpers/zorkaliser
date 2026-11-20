import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { SceneCacheStore } from './cache/store.js';
import { loadConfig, type AppConfig } from './config.js';
import { createSceneDirector, type SceneDirector } from './director/sceneDirector.js';
import { SceneJobManager } from './jobs/jobManager.js';
import { createImageOrchestrator, type ImageOrchestrator } from './providers/imageProviders.js';
import { registerMetaRoutes } from './routes/meta.js';
import { registerProxyRoutes } from './routes/proxy.js';
import { registerSceneRoutes } from './routes/scenes.js';

export interface CreateAppOptions {
  config?: AppConfig;
  dbFilename?: string;
  mockDelayMs?: number;
  director?: SceneDirector;
  orchestrator?: ImageOrchestrator;
}

export async function createApp(options: CreateAppOptions = {}): Promise<{
  app: FastifyInstance;
  config: AppConfig;
  cache: SceneCacheStore;
  jobs: SceneJobManager;
}> {
  const config = options.config ?? loadConfig();
  const app = Fastify({ logger: false });

  await app.register(cors, {
    origin: config.CORS_ORIGIN === '*' ? true : [config.CORS_ORIGIN, 'http://127.0.0.1:5173'],
    methods: ['GET', 'POST', 'OPTIONS'],
  });

  await app.register(rateLimit, {
    max: Math.max(config.RATE_LIMIT_MAX_GENERATIONS_PER_10M * 4, 120),
    timeWindow: '10 minutes',
  });

  const cache = new SceneCacheStore(config.DATA_DIR, options.dbFilename);
  const director = options.director ?? createSceneDirector(config);
  const orchestrator =
    options.orchestrator ??
    createImageOrchestrator(config, { mockDelayMs: options.mockDelayMs });
  const jobs = new SceneJobManager();

  await registerMetaRoutes(app, config);
  await registerProxyRoutes(app);
  await registerSceneRoutes(app, { config, cache, director, orchestrator, jobs });

  app.addHook('onClose', async () => {
    jobs.dispose();
    cache.close();
  });

  return { app, config, cache, jobs };
}
