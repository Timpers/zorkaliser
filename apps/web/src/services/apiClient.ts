import type {
  CatalogEntry,
  RegenerateSceneRequest,
  SceneJobEvent,
  SceneProcessRequest,
  SceneProcessResponse,
  StylePreset,
} from '@zorkaliser/shared';

export interface HealthResponse {
  status: string;
  providers: {
    llm: string;
    image: string;
    geminiConfigured: boolean;
    openaiConfigured: boolean;
    falConfigured: boolean;
  };
}

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch('/api/health');
  if (!res.ok) throw new Error(`Health check failed (${res.status})`);
  return res.json() as Promise<HealthResponse>;
}

export async function fetchStyles(): Promise<StylePreset[]> {
  const res = await fetch('/api/styles');
  if (!res.ok) throw new Error(`Failed loading styles (${res.status})`);
  const data = (await res.json()) as { styles: StylePreset[] };
  return data.styles;
}

export async function fetchCatalog(): Promise<CatalogEntry[]> {
  const res = await fetch('/api/catalog');
  if (!res.ok) throw new Error(`Failed loading catalog (${res.status})`);
  const data = (await res.json()) as { stories: CatalogEntry[] };
  return data.stories;
}

export async function fetchStoryViaProxy(url: string): Promise<{
  bytes: Uint8Array;
  filename: string;
}> {
  const res = await fetch('/api/proxy/story', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });

  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody.error || `Failed fetching story (HTTP ${res.status})`);
  }

  const filename = res.headers.get('X-Story-Filename') || 'story.z5';
  const buf = await res.arrayBuffer();
  return { bytes: new Uint8Array(buf), filename };
}

export async function processSceneTurn(
  req: SceneProcessRequest,
  signal?: AbortSignal,
): Promise<SceneProcessResponse> {
  const res = await fetch('/api/scenes/process', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    signal,
  });

  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody.error || `Scene process failed (HTTP ${res.status})`);
  }

  return res.json() as Promise<SceneProcessResponse>;
}

export async function regenerateScene(
  req: RegenerateSceneRequest,
  signal?: AbortSignal,
): Promise<{ status: 'generating'; jobId: string; streamUrl: string; cacheKey: string }> {
  const res = await fetch('/api/scenes/regenerate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    signal,
  });

  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody.error || `Regenerate failed (HTTP ${res.status})`);
  }

  return res.json();
}

export async function cancelSceneJob(jobId: string): Promise<void> {
  await fetch(`/api/scenes/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
  }).catch(() => {});
}

export function subscribeToSceneJob(
  streamUrl: string,
  onEvent: (event: SceneJobEvent) => void,
  onTransportError: (message: string) => void,
): () => void {
  const source = new EventSource(streamUrl);
  let closed = false;

  source.onmessage = (ev) => {
    try {
      const parsed = JSON.parse(ev.data) as SceneJobEvent;
      onEvent(parsed);
      if (parsed.type === 'completed' || parsed.type === 'failed') {
        closed = true;
        source.close();
      }
    } catch {
      // ignore malformed SSE chunk
    }
  };

  source.onerror = () => {
    if (!closed) {
      closed = true;
      source.close();
      onTransportError('Lost connection to scene illustration stream');
    }
  };

  return () => {
    if (!closed) {
      closed = true;
      source.close();
    }
  };
}
