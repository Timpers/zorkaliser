import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load root .env first, then apps/api/.env if present
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const optionalPositiveInt = z.preprocess(
  (v) => (v === '' || v === undefined || v === null ? undefined : Number(v)),
  z.number().int().min(1).max(150).optional(),
);

const optionalNumber = z.preprocess(
  (v) => (v === '' || v === undefined || v === null ? undefined : Number(v)),
  z.number().min(0).max(30).optional(),
);

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().default('127.0.0.1'),
  LLM_PROVIDER: z.enum(['auto', 'gemini', 'openai', 'lemonade', 'mock']).default('auto'),
  IMAGE_PROVIDER: z
    .enum(['auto', 'gemini', 'imagen', 'fal', 'openai', 'lemonade', 'mock'])
    .default('auto'),

  GEMINI_API_KEY: z.string().optional(),
  GEMINI_LLM_MODEL: z.string().default('gemini-3.8-flash'),
  GEMINI_IMAGE_MODEL: z.string().default('gemini-3.1-flash-image'),
  GEMINI_IMAGE_FALLBACK_MODEL: z.string().default('gemini-3.1-flash-lite-image'),
  GEMINI_IMAGE_HIGH_MODEL: z.string().default('gemini-3-pro-image'),
  IMAGEN_MODEL: z.string().default('imagen-4.0-generate-001'),

  LEMONADE_BASE_URL: z.string().default('http://localhost:13305/v1'),
  LEMONADE_API_KEY: z.string().default('lemonade'),
  LEMONADE_LLM_MODEL: z.string().optional(),
  LEMONADE_IMAGE_MODEL: z.string().default('SDXL-Turbo'),
  LEMONADE_IMAGE_STEPS: optionalPositiveInt,
  LEMONADE_IMAGE_CFG_SCALE: optionalNumber,
  LEMONADE_TIMEOUT_MS: z.coerce.number().int().min(5000).max(600000).default(120000),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_LLM_MODEL: z.string().default('gpt-4o-mini'),
  OPENAI_IMAGE_MODEL: z.string().default('gpt-image-1'),

  FAL_KEY: z.string().optional(),
  FAL_FAST_MODEL: z.string().default('fal-ai/flux/schnell'),
  FAL_BALANCED_MODEL: z.string().default('fal-ai/flux/dev'),

  DATA_DIR: z.string().default(path.resolve(__dirname, '../data')),
  RATE_LIMIT_MAX_GENERATIONS_PER_10M: z.coerce.number().int().min(1).default(30),
  DAILY_COST_CAP_USD: z.coerce.number().min(0).default(10.0),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
});

export type AppConfig = z.infer<typeof EnvSchema> & {
  resolvedLlmProvider: 'gemini' | 'openai' | 'lemonade' | 'mock';
  resolvedImageProvider: 'gemini' | 'imagen' | 'fal' | 'openai' | 'lemonade' | 'mock';
};

export function loadConfig(overrides: Partial<NodeJS.ProcessEnv> = {}): AppConfig {
  const parsed = EnvSchema.parse({ ...process.env, ...overrides });

  const resolvedLlmProvider: AppConfig['resolvedLlmProvider'] =
    parsed.LLM_PROVIDER !== 'auto'
      ? parsed.LLM_PROVIDER
      : parsed.GEMINI_API_KEY
        ? 'gemini'
        : parsed.OPENAI_API_KEY
          ? 'openai'
          : 'mock';

  const resolvedImageProvider: AppConfig['resolvedImageProvider'] =
    parsed.IMAGE_PROVIDER !== 'auto'
      ? parsed.IMAGE_PROVIDER
      : parsed.GEMINI_API_KEY
        ? 'gemini'
        : parsed.FAL_KEY
          ? 'fal'
          : parsed.OPENAI_API_KEY
            ? 'openai'
            : 'mock';

  return {
    ...parsed,
    resolvedLlmProvider,
    resolvedImageProvider,
  };
}
