import { getStylePreset, type AspectRatio, type QualityTier } from '@zorkaliser/shared';
import type { AppConfig } from '../config.js';

export interface ImageGenerationRequest {
  prompt: string;
  negativePrompt?: string;
  aspectRatio: AspectRatio;
  quality: QualityTier;
  seed?: number;
  stylePresetId?: string;
  displayTitle?: string;
  stateTags?: string[];
}

export interface ImageGenerationResult {
  imageBytes: Buffer;
  mimeType: 'image/webp' | 'image/png' | 'image/jpeg' | 'image/svg+xml';
  width: number;
  height: number;
  provider: string;
  model: string;
  latencyMs: number;
  estimatedCostUsd: number;
}

export interface ImageProviderAdapter {
  readonly id: string;
  generate(req: ImageGenerationRequest, signal?: AbortSignal): Promise<ImageGenerationResult>;
}

export class SafetyFilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SafetyFilterError';
  }
}

export class ProviderQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderQuotaError';
  }
}

function dimensionsForAspect(aspectRatio: AspectRatio): { width: number; height: number } {
  switch (aspectRatio) {
    case '4:3':
      return { width: 1152, height: 864 };
    case '1:1':
      return { width: 1024, height: 1024 };
    default:
      return { width: 1280, height: 720 };
  }
}

/**
 * Primary Google Gemini native image generation adapter (gemini-3.1-flash-image / generateContent).
 */
export class GoogleGeminiImageAdapter implements ImageProviderAdapter {
  readonly id = 'gemini';
  private readonly apiKey: string;
  private readonly model: string;
  private readonly highModel?: string;

  constructor(apiKey: string, model: string, highModel?: string) {
    this.apiKey = apiKey;
    this.model = model;
    this.highModel = highModel;
  }

  async generate(req: ImageGenerationRequest, signal?: AbortSignal): Promise<ImageGenerationResult> {
    const start = Date.now();
    const { width, height } = dimensionsForAspect(req.aspectRatio);
    const activeModel = req.quality === 'high' && this.highModel ? this.highModel : this.model;
    const promptWithNegatives = req.negativePrompt
      ? `${req.prompt}\n\nStrictly avoid: ${req.negativePrompt}`
      : req.prompt;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(activeModel)}:generateContent`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: promptWithNegatives }],
          },
        ],
        generationConfig: {
          responseModalities: ['IMAGE'],
          imageConfig: {
            aspectRatio: req.aspectRatio,
          },
        },
      }),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      if (response.status === 429) {
        throw new ProviderQuotaError(
          `Gemini image generation quota exceeded on ${activeModel} (HTTP 429). Enable billing on your Google AI Studio project at https://ai.dev/rate-limit, or set IMAGE_PROVIDER=mock in .env for keyless preview mode.`,
        );
      }
      if (response.status === 400 && /safety|blocked|policy/i.test(errText)) {
        throw new SafetyFilterError(`Gemini image safety filter: ${errText.slice(0, 200)}`);
      }
      throw new Error(`Gemini Image (${activeModel}) HTTP ${response.status}: ${errText.slice(0, 300)}`);
    }

    const payload = (await response.json()) as {
      candidates?: Array<{
        finishReason?: string;
        content?: {
          parts?: Array<{
            inlineData?: { mimeType?: string; data?: string };
            inline_data?: { mime_type?: string; data?: string };
          }>;
        };
      }>;
      promptFeedback?: { blockReason?: string };
    };

    if (payload.promptFeedback?.blockReason) {
      throw new SafetyFilterError(`Gemini blocked prompt: ${payload.promptFeedback.blockReason}`);
    }

    const candidate = payload.candidates?.[0];
    if (candidate?.finishReason === 'SAFETY' || candidate?.finishReason === 'IMAGE_SAFETY') {
      throw new SafetyFilterError(`Gemini finishReason: ${candidate.finishReason}`);
    }

    const parts = candidate?.content?.parts ?? [];
    for (const part of parts) {
      const inline =
        part.inlineData ??
        (part.inline_data
          ? { mimeType: part.inline_data.mime_type, data: part.inline_data.data }
          : undefined);
      if (inline?.data) {
        const mime = (inline.mimeType || 'image/png') as ImageGenerationResult['mimeType'];
        return {
          imageBytes: Buffer.from(inline.data, 'base64'),
          mimeType: mime,
          width,
          height,
          provider: 'gemini',
          model: activeModel,
          latencyMs: Date.now() - start,
          estimatedCostUsd: 0.039,
        };
      }
    }

    throw new Error(`Gemini (${activeModel}) returned no image inlineData part`);
  }
}

/**
 * Dedicated Google Imagen adapter (imagen-3.0-generate-002 / :predict).
 */
export class GoogleImagenAdapter implements ImageProviderAdapter {
  readonly id = 'imagen';
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async generate(req: ImageGenerationRequest, signal?: AbortSignal): Promise<ImageGenerationResult> {
    const start = Date.now();
    const { width, height } = dimensionsForAspect(req.aspectRatio);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:predict`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify({
        instances: [{ prompt: req.prompt }],
        parameters: {
          sampleCount: 1,
          aspectRatio: req.aspectRatio,
        },
      }),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      if (/safety|blocked|policy/i.test(errText)) {
        throw new SafetyFilterError(`Imagen safety filter: ${errText.slice(0, 200)}`);
      }
      throw new Error(`Imagen HTTP ${response.status}: ${errText.slice(0, 300)}`);
    }

    const payload = (await response.json()) as {
      predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
    };
    const prediction = payload.predictions?.[0];
    if (!prediction?.bytesBase64Encoded) {
      throw new Error('Imagen returned no prediction image bytes');
    }

    return {
      imageBytes: Buffer.from(prediction.bytesBase64Encoded, 'base64'),
      mimeType: (prediction.mimeType || 'image/png') as ImageGenerationResult['mimeType'],
      width,
      height,
      provider: 'imagen',
      model: this.model,
      latencyMs: Date.now() - start,
      estimatedCostUsd: 0.03,
    };
  }
}

/**
 * FAL.ai Flux adapter (Schnell / Dev).
 */
export class FalFluxAdapter implements ImageProviderAdapter {
  readonly id = 'fal';
  private readonly apiKey: string;
  private readonly fastModel: string;
  private readonly balancedModel: string;

  constructor(apiKey: string, fastModel: string, balancedModel: string) {
    this.apiKey = apiKey;
    this.fastModel = fastModel;
    this.balancedModel = balancedModel;
  }

  async generate(req: ImageGenerationRequest, signal?: AbortSignal): Promise<ImageGenerationResult> {
    const start = Date.now();
    const { width, height } = dimensionsForAspect(req.aspectRatio);
    const model = req.quality === 'fast' ? this.fastModel : this.balancedModel;
    const imageSize =
      req.aspectRatio === '16:9'
        ? 'landscape_16_9'
        : req.aspectRatio === '4:3'
          ? 'landscape_4_3'
          : 'square_hd';

    const response = await fetch(`https://fal.run/${model}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Key ${this.apiKey}`,
      },
      body: JSON.stringify({
        prompt: req.prompt,
        image_size: imageSize,
        num_images: 1,
        seed: req.seed,
        output_format: 'webp',
      }),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`FAL Flux HTTP ${response.status}: ${errText.slice(0, 300)}`);
    }

    const payload = (await response.json()) as {
      images?: Array<{ url: string; width?: number; height?: number; content_type?: string }>;
    };
    const image = payload.images?.[0];
    if (!image?.url) {
      throw new Error('FAL Flux returned no image URL');
    }

    const imgRes = await fetch(image.url, { signal });
    if (!imgRes.ok) {
      throw new Error(`Failed downloading FAL image: HTTP ${imgRes.status}`);
    }
    const bytes = Buffer.from(await imgRes.arrayBuffer());

    return {
      imageBytes: bytes,
      mimeType: (image.content_type || 'image/webp') as ImageGenerationResult['mimeType'],
      width: image.width ?? width,
      height: image.height ?? height,
      provider: 'fal',
      model,
      latencyMs: Date.now() - start,
      estimatedCostUsd: req.quality === 'fast' ? 0.005 : 0.025,
    };
  }
}

function detectImageMimeType(bytes: Buffer): ImageGenerationResult['mimeType'] {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return 'image/png';
}

export function normalizeLocalBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (/\/(api\/)?v1$/i.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}/v1`;
}

export interface LemonadeImageAdapterOptions {
  baseUrl: string;
  apiKey?: string;
  model: string;
  steps?: number;
  cfgScale?: number;
  timeoutMs?: number;
}

/**
 * Local Lemonade Server / OpenAI-compatible image generation adapter (/v1/images/generations).
 * Works with Lemonade's sd-cpp backend (SDXL-Turbo, FLUX.1-schnell, Z-Image-Turbo, etc.).
 */
export class LemonadeImageAdapter implements ImageProviderAdapter {
  readonly id = 'lemonade';
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly steps?: number;
  private readonly cfgScale?: number;
  private readonly timeoutMs: number;

  constructor(options: LemonadeImageAdapterOptions) {
    this.baseUrl = normalizeLocalBaseUrl(options.baseUrl);
    this.apiKey = options.apiKey ?? 'lemonade';
    this.model = options.model;
    this.steps = options.steps;
    this.cfgScale = options.cfgScale;
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  private resolveDimensions(aspectRatio: AspectRatio, quality: QualityTier): { width: number; height: number } {
    // Keep dimensions multiples of 64 for stable-diffusion.cpp / DiT compatibility & speed on 24GB GPUs
    if (quality === 'high') {
      switch (aspectRatio) {
        case '4:3':
          return { width: 1024, height: 768 };
        case '1:1':
          return { width: 1024, height: 1024 };
        default:
          return { width: 1280, height: 704 };
      }
    }
    switch (aspectRatio) {
      case '4:3':
        return { width: 896, height: 672 };
      case '1:1':
        return { width: 768, height: 768 };
      default:
        return { width: 1024, height: 576 };
    }
  }

  async generate(req: ImageGenerationRequest, signal?: AbortSignal): Promise<ImageGenerationResult> {
    const start = Date.now();
    const { width, height } = this.resolveDimensions(req.aspectRatio, req.quality);
    const endpoint = `${this.baseUrl}/images/generations`;

    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), this.timeoutMs);
    const combinedSignal = signal
      ? AbortSignal.any([signal, timeoutController.signal])
      : timeoutController.signal;

    const payloadBody: Record<string, unknown> = {
      model: this.model,
      prompt: req.prompt,
      n: 1,
      size: `${width}x${height}`,
      response_format: 'b64_json',
    };

    if (this.steps !== undefined) {
      payloadBody.steps = this.steps;
    }
    if (this.cfgScale !== undefined) {
      payloadBody.cfg_scale = this.cfgScale;
    }
    if (req.negativePrompt) {
      payloadBody.negative_prompt = req.negativePrompt;
    }
    if (req.seed !== undefined) {
      payloadBody.seed = req.seed;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payloadBody),
        signal: combinedSignal,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(
          `Lemonade Image (${this.model}) HTTP ${response.status}: ${errText.slice(0, 300)}`,
        );
      }

      const payload = (await response.json()) as {
        data?: Array<{ b64_json?: string; url?: string }>;
      };
      const item = payload.data?.[0];
      let bytes: Buffer;

      if (item?.b64_json) {
        const cleaned = item.b64_json.replace(/^data:image\/[a-z+]+;base64,/i, '');
        bytes = Buffer.from(cleaned, 'base64');
      } else if (item?.url) {
        const imgRes = await fetch(item.url, { signal: combinedSignal });
        if (!imgRes.ok) {
          throw new Error(`Failed downloading Lemonade image URL: HTTP ${imgRes.status}`);
        }
        bytes = Buffer.from(await imgRes.arrayBuffer());
      } else {
        throw new Error(`Lemonade (${this.model}) returned neither b64_json nor url`);
      }

      return {
        imageBytes: bytes,
        mimeType: detectImageMimeType(bytes),
        width,
        height,
        provider: 'lemonade',
        model: this.model,
        latencyMs: Date.now() - start,
        estimatedCostUsd: 0,
      };
    } catch (err) {
      if (signal?.aborted) throw err;
      if (timeoutController.signal.aborted) {
        throw new Error(
          `Lemonade Server at ${endpoint} timed out after ${Math.round(this.timeoutMs / 1000)}s (model "${this.model}" may still be loading).`,
        );
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (/fetch failed|ECONNREFUSED|EHOSTUNREACH|ETIMEDOUT|ENOTFOUND/i.test(msg)) {
        throw new Error(
          `Could not reach Lemonade Server at ${endpoint}. Ensure Lemonade is running (with --host 0.0.0.0 if on another LAN machine) and port is open.`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * OpenAI Image adapter (gpt-image-1).
 */
export class OpenAIImageAdapter implements ImageProviderAdapter {
  readonly id = 'openai';
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async generate(req: ImageGenerationRequest, signal?: AbortSignal): Promise<ImageGenerationResult> {
    const start = Date.now();
    const size = req.aspectRatio === '1:1' ? '1024x1024' : '1536x1024';
    const [width, height] = size.split('x').map(Number);

    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        prompt: req.prompt,
        size,
        quality: req.quality === 'high' ? 'high' : req.quality === 'balanced' ? 'medium' : 'low',
        output_format: 'webp',
      }),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      if (/safety|content_policy/i.test(errText)) {
        throw new SafetyFilterError(`OpenAI safety filter: ${errText.slice(0, 200)}`);
      }
      throw new Error(`OpenAI Image HTTP ${response.status}: ${errText.slice(0, 300)}`);
    }

    const payload = (await response.json()) as {
      data?: Array<{ b64_json?: string; url?: string }>;
    };
    const item = payload.data?.[0];
    let bytes: Buffer;
    if (item?.b64_json) {
      bytes = Buffer.from(item.b64_json, 'base64');
    } else if (item?.url) {
      const imgRes = await fetch(item.url, { signal });
      bytes = Buffer.from(await imgRes.arrayBuffer());
    } else {
      throw new Error('OpenAI Image returned neither b64_json nor url');
    }

    return {
      imageBytes: bytes,
      mimeType: 'image/webp',
      width,
      height,
      provider: 'openai',
      model: this.model,
      latencyMs: Date.now() - start,
      estimatedCostUsd: req.quality === 'fast' ? 0.015 : 0.04,
    };
  }
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * Stylized procedural SVG mock image provider so Zorkaliser works end-to-end with
 * zero external keys during local testing and CI.
 */
export class MockSvgImageAdapter implements ImageProviderAdapter {
  readonly id = 'mock';
  private readonly simulatedDelayMs: number;

  constructor(simulatedDelayMs = 250) {
    this.simulatedDelayMs = simulatedDelayMs;
  }

  async generate(req: ImageGenerationRequest, signal?: AbortSignal): Promise<ImageGenerationResult> {
    const start = Date.now();
    if (this.simulatedDelayMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, this.simulatedDelayMs);
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('Aborted'));
        });
      });
    }

    const { width, height } = dimensionsForAspect(req.aspectRatio);
    const preset = getStylePreset(req.stylePresetId ?? 'fantasy-oil');
    const [bg1, bg2] = preset?.gradient ?? ['#1e1b4b', '#312e81'];
    const accent = preset?.accentColor ?? '#f59e0b';
    const seed = hashSeed(`${req.prompt}|${req.seed ?? 0}`);
    const isDark = /darkness|pitch black/i.test(req.displayTitle ?? req.prompt);

    const stars = Array.from({ length: 28 }, (_, i) => {
      const s = hashSeed(`${seed}-star-${i}`);
      const cx = (s % (width - 80)) + 40;
      const cy = ((s >> 6) % Math.floor(height * 0.55)) + 20;
      const r = ((s >> 12) % 3) + 1;
      const op = (((s >> 16) % 60) + 25) / 100;
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffffff" opacity="${op.toFixed(2)}" />`;
    }).join('');

    const hillOffset = (seed % 90) - 45;
    const moonX = Math.floor(width * (0.2 + ((seed % 60) / 100)));
    const moonY = Math.floor(height * 0.25);

    const title = escapeXml((req.displayTitle || 'Illustrated Scene').slice(0, 44));
    const styleLabel = escapeXml(preset?.name ?? 'Custom Style');
    const tagsLabel = escapeXml(
      (req.stateTags ?? []).slice(0, 4).join('  •  ') || 'Preview Mode (Set GEMINI_API_KEY for live AI art)',
    );

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${isDark ? '#020204' : bg1}"/>
      <stop offset="100%" stop-color="${isDark ? '#09090b' : bg2}"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="45%" r="55%">
      <stop offset="0%" stop-color="${accent}" stop-opacity="${isDark ? '0.14' : '0.45'}"/>
      <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#sky)"/>
  <rect width="${width}" height="${height}" fill="url(#glow)"/>
  ${stars}
  ${
    isDark
      ? `<circle cx="${Math.floor(width / 2)}" cy="${Math.floor(height / 2)}" r="90" fill="${accent}" opacity="0.08"/>`
      : `<circle cx="${moonX}" cy="${moonY}" r="54" fill="${accent}" opacity="0.85"/>
  <path d="M0 ${height} L0 ${Math.floor(height * 0.62) + hillOffset} Q ${Math.floor(width * 0.28)} ${Math.floor(height * 0.45)} ${Math.floor(width * 0.55)} ${Math.floor(height * 0.64)} T ${width} ${Math.floor(height * 0.56)} L ${width} ${height} Z" fill="#09090b" opacity="0.55"/>
  <path d="M0 ${height} L0 ${Math.floor(height * 0.76)} Q ${Math.floor(width * 0.4)} ${Math.floor(height * 0.62) - hillOffset} ${Math.floor(width * 0.75)} ${Math.floor(height * 0.78)} T ${width} ${Math.floor(height * 0.72)} L ${width} ${height} Z" fill="#09090b" opacity="0.82"/>`
  }
  <rect x="44" y="${height - 134}" width="${width - 88}" height="92" rx="14" fill="#09090b" fill-opacity="0.62" stroke="${accent}" stroke-opacity="0.45"/>
  <text x="70" y="${height - 92}" fill="#fafaf9" font-family="Georgia, serif" font-size="30" font-weight="600">${title}</text>
  <text x="70" y="${height - 62}" fill="#d6d3d1" font-family="system-ui, sans-serif" font-size="16">${styleLabel}  ·  ${tagsLabel}</text>
</svg>`;

    return {
      imageBytes: Buffer.from(svg, 'utf-8'),
      mimeType: 'image/svg+xml',
      width,
      height,
      provider: 'mock',
      model: 'procedural-svg-v1',
      latencyMs: Date.now() - start,
      estimatedCostUsd: 0,
    };
  }
}

export class ImageOrchestrator {
  private readonly primary: ImageProviderAdapter;
  private readonly fallback?: ImageProviderAdapter;

  constructor(primary: ImageProviderAdapter, fallback?: ImageProviderAdapter) {
    this.primary = primary;
    this.fallback = fallback;
  }

  get primaryProviderId(): string {
    return this.primary.id;
  }

  async generate(req: ImageGenerationRequest, signal?: AbortSignal): Promise<ImageGenerationResult> {
    try {
      return await this.primary.generate(req, signal);
    } catch (err) {
      if (signal?.aborted) throw err;

      // Retry once with a softened atmospheric prompt if blocked by safety filters
      if (err instanceof SafetyFilterError) {
        const softenedPrompt = `Peaceful, atmospheric, painterly landscape view of "${req.displayTitle ?? 'an adventure location'}". Focus strictly on architecture, lighting, environment, and mood without any violence or weapons. ${req.prompt.slice(0, 350)}`;
        try {
          return await this.primary.generate({ ...req, prompt: softenedPrompt }, signal);
        } catch (retryErr) {
          if (this.fallback) {
            return this.fallback.generate({ ...req, prompt: softenedPrompt }, signal);
          }
          throw retryErr;
        }
      }

      if (this.fallback) {
        console.warn(
          `[ImageOrchestrator] Primary (${this.primary.id}) failed, falling back to (${this.fallback.id}):`,
          err,
        );
        try {
          return await this.fallback.generate(req, signal);
        } catch (fallbackErr) {
          // Never mask the primary error (e.g., 429 quota) behind a secondary fallback error
          if (err instanceof ProviderQuotaError || fallbackErr instanceof ProviderQuotaError) {
            throw err instanceof ProviderQuotaError ? err : fallbackErr;
          }
          const primaryMsg = err instanceof Error ? err.message : String(err);
          const fallbackMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
          throw new Error(`${primaryMsg} (fallback also failed: ${fallbackMsg})`);
        }
      }

      throw err;
    }
  }
}

export function createImageOrchestrator(
  config: AppConfig,
  options: { mockDelayMs?: number } = {},
): ImageOrchestrator {
  const mock = new MockSvgImageAdapter(options.mockDelayMs ?? 250);

  if (config.resolvedImageProvider === 'gemini' && config.GEMINI_API_KEY) {
    const primary = new GoogleGeminiImageAdapter(
      config.GEMINI_API_KEY,
      config.GEMINI_IMAGE_MODEL,
      config.GEMINI_IMAGE_HIGH_MODEL,
    );
    const fallback =
      config.GEMINI_IMAGE_FALLBACK_MODEL &&
      config.GEMINI_IMAGE_FALLBACK_MODEL !== config.GEMINI_IMAGE_MODEL
        ? new GoogleGeminiImageAdapter(config.GEMINI_API_KEY, config.GEMINI_IMAGE_FALLBACK_MODEL)
        : undefined;
    return new ImageOrchestrator(primary, fallback);
  }

  if (config.resolvedImageProvider === 'imagen' && config.GEMINI_API_KEY) {
    const primary = new GoogleImagenAdapter(config.GEMINI_API_KEY, config.IMAGEN_MODEL);
    const geminiFallback = new GoogleGeminiImageAdapter(
      config.GEMINI_API_KEY,
      config.GEMINI_IMAGE_MODEL,
    );
    return new ImageOrchestrator(primary, geminiFallback);
  }

  if (config.resolvedImageProvider === 'lemonade') {
    const primary = new LemonadeImageAdapter({
      baseUrl: config.LEMONADE_BASE_URL,
      apiKey: config.LEMONADE_API_KEY,
      model: config.LEMONADE_IMAGE_MODEL,
      steps: config.LEMONADE_IMAGE_STEPS,
      cfgScale: config.LEMONADE_IMAGE_CFG_SCALE,
      timeoutMs: config.LEMONADE_TIMEOUT_MS,
    });
    return new ImageOrchestrator(primary);
  }

  if (config.resolvedImageProvider === 'fal' && config.FAL_KEY) {
    const primary = new FalFluxAdapter(
      config.FAL_KEY,
      config.FAL_FAST_MODEL,
      config.FAL_BALANCED_MODEL,
    );
    return new ImageOrchestrator(primary);
  }

  if (config.resolvedImageProvider === 'openai' && config.OPENAI_API_KEY) {
    const primary = new OpenAIImageAdapter(config.OPENAI_API_KEY, config.OPENAI_IMAGE_MODEL);
    return new ImageOrchestrator(primary);
  }

  return new ImageOrchestrator(mock);
}
