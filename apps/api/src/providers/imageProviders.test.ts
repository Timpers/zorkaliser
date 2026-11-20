import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GoogleGeminiImageAdapter,
  ImageOrchestrator,
  LemonadeImageAdapter,
  ProviderQuotaError,
  normalizeLocalBaseUrl,
  type ImageGenerationRequest,
  type ImageGenerationResult,
  type ImageProviderAdapter,
} from './imageProviders.js';

const sampleReq: ImageGenerationRequest = {
  prompt: 'West of House in 1980s oil painting style',
  aspectRatio: '16:9',
  quality: 'fast',
  displayTitle: 'West of House',
};

const okResult: ImageGenerationResult = {
  imageBytes: Buffer.from('fake-png-bytes'),
  mimeType: 'image/png',
  width: 1280,
  height: 720,
  provider: 'gemini',
  model: 'gemini-3.1-flash-lite-image',
  latencyMs: 50,
  estimatedCostUsd: 0.02,
};

describe('GoogleGeminiImageAdapter & ImageOrchestrator', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses inlineData image from Gemini generateContent response', async () => {
    const b64 = Buffer.from('hello-image').toString('base64');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ inlineData: { mimeType: 'image/png', data: b64 } }],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const adapter = new GoogleGeminiImageAdapter('test-key', 'gemini-3.1-flash-image');
    const result = await adapter.generate(sampleReq);
    expect(result.imageBytes.toString()).toBe('hello-image');
    expect(result.model).toBe('gemini-3.1-flash-image');
  });

  it('throws ProviderQuotaError with actionable guidance on HTTP 429', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 429, message: 'Quota exceeded' } }), {
        status: 429,
      }),
    );

    const adapter = new GoogleGeminiImageAdapter('test-key', 'gemini-3.1-flash-image');
    await expect(adapter.generate(sampleReq)).rejects.toThrow(ProviderQuotaError);
  });

  it('preserves primary ProviderQuotaError instead of masking it behind a fallback 404', async () => {
    const primary: ImageProviderAdapter = {
      id: 'gemini',
      async generate() {
        throw new ProviderQuotaError('Gemini image generation quota exceeded (HTTP 429)');
      },
    };
    const fallback: ImageProviderAdapter = {
      id: 'imagen',
      async generate() {
        throw new Error('Imagen HTTP 404: model not found');
      },
    };

    const orchestrator = new ImageOrchestrator(primary, fallback);
    await expect(orchestrator.generate(sampleReq)).rejects.toThrow(/quota exceeded/i);
  });

  it('falls back cleanly when primary hits a transient 503 and secondary succeeds', async () => {
    const primary: ImageProviderAdapter = {
      id: 'gemini',
      async generate() {
        throw new Error('HTTP 503 overloaded');
      },
    };
    const fallback: ImageProviderAdapter = {
      id: 'gemini',
      async generate() {
        return okResult;
      },
    };

    const orchestrator = new ImageOrchestrator(primary, fallback);
    const res = await orchestrator.generate(sampleReq);
    expect(res.model).toBe('gemini-3.1-flash-lite-image');
  });

  it('normalizes Lemonade base URLs cleanly', () => {
    expect(normalizeLocalBaseUrl('http://192.168.0.64:13305')).toBe('http://192.168.0.64:13305/v1');
    expect(normalizeLocalBaseUrl('http://192.168.0.64:13305/v1/')).toBe('http://192.168.0.64:13305/v1');
    expect(normalizeLocalBaseUrl('http://192.168.0.64:13305/api/v1')).toBe('http://192.168.0.64:13305/api/v1');
  });

  it('calls Lemonade /v1/images/generations with expected payload and decodes PNG b64_json', async () => {
    const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ b64_json: fakePng.toString('base64') }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const adapter = new LemonadeImageAdapter({
      baseUrl: 'http://192.168.0.64:13305',
      model: 'SDXL-Turbo',
      steps: 4,
      cfgScale: 1.0,
    });

    const result = await adapter.generate({
      ...sampleReq,
      negativePrompt: 'text, watermark',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://192.168.0.64:13305/v1/images/generations');
    const sent = JSON.parse(String(init?.body));
    expect(sent.model).toBe('SDXL-Turbo');
    expect(sent.size).toBe('1024x576');
    expect(sent.steps).toBe(4);
    expect(sent.cfg_scale).toBe(1);
    expect(sent.response_format).toBe('b64_json');
    expect(result.provider).toBe('lemonade');
    expect(result.mimeType).toBe('image/png');
    expect(result.estimatedCostUsd).toBe(0);
    expect(result.imageBytes.equals(fakePng)).toBe(true);
  });

  it('gives an actionable error when Lemonade Server is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('fetch failed'));

    const adapter = new LemonadeImageAdapter({
      baseUrl: 'http://192.168.0.64:13305/v1',
      model: 'SDXL-Turbo',
    });

    await expect(adapter.generate(sampleReq)).rejects.toThrow(/Could not reach Lemonade Server/i);
  });
});
