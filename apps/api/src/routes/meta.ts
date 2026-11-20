import type { FastifyInstance } from 'fastify';
import { FREE_STORY_CATALOG, STYLE_PRESETS } from '@zorkaliser/shared';
import type { AppConfig } from '../config.js';

export async function registerMetaRoutes(app: FastifyInstance, config: AppConfig): Promise<void> {
  app.get('/api/health', async () => ({
    status: 'ok',
    providers: {
      llm: config.resolvedLlmProvider,
      image: config.resolvedImageProvider,
      geminiConfigured: Boolean(config.GEMINI_API_KEY),
      openaiConfigured: Boolean(config.OPENAI_API_KEY),
      falConfigured: Boolean(config.FAL_KEY),
      lemonadeConfigured: Boolean(config.LEMONADE_BASE_URL),
      lemonadeImageModel: config.LEMONADE_IMAGE_MODEL,
    },
  }));

  app.get('/api/styles', async () => ({
    styles: STYLE_PRESETS,
  }));

  app.get('/api/catalog', async () => ({
    stories: FREE_STORY_CATALOG,
  }));
}
