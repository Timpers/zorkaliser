import {
  SceneDirectorOutputSchema,
  canonicalizeStateTags,
  getStylePreset,
  normalizeLocationKey,
  type SceneDirectorOutput,
  type SceneProcessRequest,
} from '@zorkaliser/shared';
import type { AppConfig } from '../config.js';

export interface SceneDirector {
  readonly id: string;
  analyze(req: SceneProcessRequest, signal?: AbortSignal): Promise<SceneDirectorOutput>;
}

const DARKNESS_PATTERNS = [
  /it is pitch black/i,
  /too dark to see/i,
  /pitch dark/i,
  /in the dark/i,
  /likely to be eaten by a grue/i,
];

const EXIT_DIRECTIONS = [
  'north',
  'south',
  'east',
  'west',
  'northeast',
  'northwest',
  'southeast',
  'southwest',
  'up',
  'down',
  'in',
  'out',
] as const;

const STATE_CHANGE_KEYWORDS = [
  { regex: /\b(lamp|lantern|torch)\b.{0,35}\b(now on|lit|glowing|shining|turned on)\b/i, tag: 'light_source:lit' },
  { regex: /\b(lamp|lantern|torch)\b.{0,35}\b(now off|extinguished|goes out|dark)\b/i, tag: 'light_source:off' },
  { regex: /\b(opening|opened|opens)\b.{0,35}\b(door|trap[- ]?door|window|chest|grating|gate)\b/i, tagFromMatch: (m: RegExpMatchArray) => `${m[2].toLowerCase().replace(/\s+/g, '_')}:open` },
  { regex: /\b(door|trap[- ]?door|window|chest|grating|gate)\b.{0,25}\b(opens|opened|is now open|swings open)\b/i, tagFromMatch: (m: RegExpMatchArray) => `${m[1].toLowerCase().replace(/\s+/g, '_')}:open` },
  { regex: /\b(closing|closed|closes)\b.{0,35}\b(door|trap[- ]?door|window|chest|grating|gate)\b/i, tagFromMatch: (m: RegExpMatchArray) => `${m[2].toLowerCase().replace(/\s+/g, '_')}:closed` },
  { regex: /\b(move|moved|push|pushed|pull|pulled)\b.{0,35}\b(rug|carpet|painting|statue|lever)\b/i, tagFromMatch: (m: RegExpMatchArray) => `${m[2].toLowerCase().replace(/\s+/g, '_')}:moved` },
  { regex: /\b(troll|thief|cyclops|dragon|guard|grue)\b/i, tagFromMatch: (m: RegExpMatchArray) => `creature:${m[1].toLowerCase()}` },
];

function resolveStyleDirective(stylePresetId: string, customStylePrompt?: string): {
  styleName: string;
  directive: string;
  negativePrompt: string;
  accentColor: string;
} {
  if (stylePresetId === 'custom' && customStylePrompt?.trim()) {
    return {
      styleName: 'Custom Style',
      directive: customStylePrompt.trim(),
      negativePrompt:
        'text, watermark, signature, UI overlay, speech bubbles, captions, borders, foreground hands, arms, first-person hands',
      accentColor: '#6366f1',
    };
  }
  const preset = getStylePreset(stylePresetId) ?? getStylePreset('fantasy-oil')!;
  return {
    styleName: preset.name,
    directive: preset.styleDirective,
    negativePrompt: preset.negativePrompt,
    accentColor: preset.accentColor,
  };
}

function buildSystemInstruction(req: SceneProcessRequest): string {
  const style = resolveStyleDirective(req.stylePresetId, req.customStylePrompt);
  return [
    'You are the Scene Director for Zorkaliser, a real-time AI illustrator for classic Z-machine interactive fiction.',
    'Analyze the latest turn from a text adventure and return ONLY valid JSON matching the exact schema below.',
    '',
    'Selected Visual Style:',
    `- Name: ${style.styleName}`,
    `- Art Direction: ${style.directive}`,
    `- Negative Cues: ${style.negativePrompt}`,
    '',
    'Rules:',
    '1. If the player entered a new location (locationKey differs from previousLocationKey, or turnIndex === 0), set shouldGenerate=true and changeType="new_location".',
    '2. If the room is pitch black / too dark to see, set shouldGenerate=true, changeType="darkness", locationKey="__darkness__", displayTitle="Pitch Black", and craft an atmospheric darkness scene in the chosen style.',
    `3. Reactivity mode is "${req.reactivityMode}".`,
    '   - If "location_only": ONLY set shouldGenerate=true when locationKey changes, darkness begins/ends, or forceGenerate is true. Always return stateTags=[] in location_only mode so revisits reuse the exact cached illustration.',
    '   - If "dynamic": Also set shouldGenerate=true with changeType="major_state_change" ONLY for dramatic architectural/lighting/creature changes (e.g. light turned on, trapdoor/gate opened, secret passage revealed, creature appeared). Do NOT trigger re-renders for taking/dropping small items.',
    '   - If nothing visually changed (e.g., error message, failed command, taking/dropping an item, reading a leaflet, checking score, examining an already-visible detail), set shouldGenerate=false and changeType="no_visual_change".',
    '4. BRIEF-mode memory: Classic games omit full room descriptions on revisits. Merge knownBaseDescription with the latest turn so updatedBaseDescription always retains architectural details.',
    '5. stateTags: Short canonical lowercase tags sorted alphabetically describing visible state in the room (e.g., ["door:boarded", "mailbox:open"]). Keep tags minimal (0 to 6 tags) to maximize cache hits.',
    '6. imagePrompt: Write a rich, concrete 2-4 sentence visual scene description as a wide, eye-level environmental establishing shot focusing purely on the architecture, landscape, lighting, and atmosphere. NEVER use phrases like "first-person POV", and NEVER depict the viewer\'s hands, arms, feet, or body in the foreground (only depict characters or creatures explicitly present in the room). Never include a modern UI, HUD, text, captions, or speech bubbles. Always weave in the selected Visual Style art direction naturally.',
    '7. Keep combat/danger atmospheric and PG-13 to avoid unnecessary image safety blocks.',
    '8. mapHints: Extract any movement direction from the command (n/s/e/w/ne/nw/se/sw/u/d/in/out) and exits mentioned in the prose.',
    '',
    'Return strict JSON with keys:',
    '{ "shouldGenerate": boolean, "changeType": "new_location"|"major_state_change"|"darkness"|"no_visual_change", "locationKey": string, "displayTitle": string, "updatedBaseDescription": string, "stateTags": string[], "imagePrompt": string, "negativePrompt": string, "paletteHint": "#hex", "mapHints": { "movementDirection": string|null, "mentionedExits": string[], "isOneWaySuspected": boolean } }',
  ].join('\n');
}

function buildUserPrompt(req: SceneProcessRequest): string {
  return JSON.stringify(
    {
      storyTitle: req.storyTitle ?? 'Interactive Fiction',
      forceGenerate: Boolean(req.forceGenerate),
      turn: {
        turnIndex: req.turn.turnIndex,
        command: req.turn.command,
        statusBarRoomTitle: req.turn.statusBarRoomTitle,
        narrativeDelta: req.turn.narrativeDelta.slice(0, 4000),
      },
      roomMemory: {
        previousLocationKey: req.roomMemory.previousLocationKey,
        knownBaseDescription: req.roomMemory.knownBaseDescription?.slice(0, 2000) ?? null,
        previousStateTags: req.roomMemory.previousStateTags,
        carriedLightSource: req.roomMemory.carriedLightSource ?? null,
      },
    },
    null,
    2,
  );
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  // Strip markdown fences if model included them
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(unfenced);
}

function postProcessDirectorOutput(
  raw: SceneDirectorOutput,
  req: SceneProcessRequest,
): SceneDirectorOutput {
  const style = resolveStyleDirective(req.stylePresetId, req.customStylePrompt);
  const locationKey =
    raw.changeType === 'darkness'
      ? '__darkness__'
      : normalizeLocationKey(raw.locationKey || raw.displayTitle);

  // In location_only mode, keep stateTags empty so cache keys depend strictly on location
  // and revisiting a room always displays the exact same cached image.
  const stateTags =
    req.reactivityMode === 'location_only' ? [] : canonicalizeStateTags(raw.stateTags);

  let shouldGenerate = raw.shouldGenerate;
  let changeType = raw.changeType;

  if (req.forceGenerate) {
    shouldGenerate = true;
  } else if (
    req.reactivityMode === 'location_only' &&
    locationKey === req.roomMemory.previousLocationKey
  ) {
    shouldGenerate = false;
    changeType = 'no_visual_change';
  }

  return {
    ...raw,
    shouldGenerate,
    changeType,
    locationKey,
    stateTags,
    negativePrompt: raw.negativePrompt || style.negativePrompt,
    paletteHint: raw.paletteHint || style.accentColor,
  };
}

/**
 * Deterministic local Scene Director used as zero-cost default when no LLM key is set,
 * as well as an automatic fallback if an external LLM call fails.
 */
export class HeuristicMockDirector implements SceneDirector {
  readonly id = 'mock';

  async analyze(req: SceneProcessRequest): Promise<SceneDirectorOutput> {
    const style = resolveStyleDirective(req.stylePresetId, req.customStylePrompt);
    const delta = req.turn.narrativeDelta.trim();
    const isDark = DARKNESS_PATTERNS.some((p) => p.test(delta));

    // Extract room title from status bar, or first short line of prose
    const firstLine = delta
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0 && l.length <= 60 && !l.endsWith('.'));
    const displayTitle = isDark
      ? 'Pitch Black'
      : req.turn.statusBarRoomTitle?.trim() ||
        firstLine ||
        (req.roomMemory.previousLocationKey
          ? req.roomMemory.previousLocationKey.replace(/_/g, ' ')
          : 'Opening Scene');

    const locationKey = isDark ? '__darkness__' : normalizeLocationKey(displayTitle);
    const isNewLocation =
      req.turn.turnIndex === 0 ||
      !req.roomMemory.previousLocationKey ||
      locationKey !== req.roomMemory.previousLocationKey;

    // Detect state tags
    const tagSet = new Set(isNewLocation ? [] : req.roomMemory.previousStateTags);
    let stateChanged = false;
    for (const rule of STATE_CHANGE_KEYWORDS) {
      const match = delta.match(rule.regex);
      if (match) {
        const tag = rule.tagFromMatch ? rule.tagFromMatch(match) : rule.tag!;
        if (!tagSet.has(tag)) {
          tagSet.add(tag);
          stateChanged = true;
        }
      }
    }
    const stateTags = canonicalizeStateTags(Array.from(tagSet)).slice(0, 6);

    // Maintain BRIEF-mode base description
    const looksLikeFullDescription = delta.length >= 70;
    const updatedBaseDescription = isDark
      ? 'Complete pitch-black subterranean darkness with only the faintest sense of cold stone walls.'
      : isNewLocation
        ? delta.slice(0, 1500)
        : looksLikeFullDescription && (!req.roomMemory.knownBaseDescription || /^l(ook)?$/i.test(req.turn.command.trim()))
          ? delta.slice(0, 1500)
          : req.roomMemory.knownBaseDescription || delta.slice(0, 1500);

    let changeType: SceneDirectorOutput['changeType'] = 'no_visual_change';
    let shouldGenerate = false;

    if (isDark && req.roomMemory.previousLocationKey !== '__darkness__') {
      changeType = 'darkness';
      shouldGenerate = true;
    } else if (isNewLocation) {
      changeType = 'new_location';
      shouldGenerate = true;
    } else if (stateChanged && req.reactivityMode === 'dynamic') {
      changeType = 'major_state_change';
      shouldGenerate = true;
    } else if (req.forceGenerate) {
      changeType = isDark ? 'darkness' : 'major_state_change';
      shouldGenerate = true;
    }

    const condensedScene = updatedBaseDescription
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 650);

    const stateSummary =
      stateTags.length > 0 ? ` Notable visible state: ${stateTags.join(', ')}.` : '';

    const imagePrompt = isDark
      ? `Wide eye-level environmental establishing shot into impenetrable subterranean darkness, subtle hints of damp ancient stone barely visible at the edges, eerie sense of unseen danger. Uninhabited scenic framing with no foreground hands, arms, or people. Style: ${style.directive}. No text, no UI.`
      : `Wide eye-level environmental establishing shot of "${displayTitle}". ${condensedScene}${stateSummary} Style: ${style.directive}. Pure scenic illustration with no foreground hands, arms, or viewer body parts, no text, no captions, no HUD.`;

    const mentionedExits = EXIT_DIRECTIONS.filter((dir) =>
      new RegExp(`\\b${dir}\\b`, 'i').test(delta),
    );
    const cmdLower = req.turn.command.trim().toLowerCase();
    const movementDirection =
      /^(n|north|s|south|e|east|w|west|ne|northeast|nw|northwest|se|southeast|sw|southwest|u|up|d|down|in|out)$/.test(
        cmdLower,
      )
        ? cmdLower
        : null;

    return postProcessDirectorOutput(
      {
        shouldGenerate,
        changeType,
        locationKey,
        displayTitle,
        updatedBaseDescription,
        stateTags,
        imagePrompt,
        negativePrompt: style.negativePrompt,
        paletteHint: style.accentColor,
        mapHints: {
          movementDirection,
          mentionedExits: [...mentionedExits],
          isOneWaySuspected: /chimney|chute|slide|falls? behind you|slams shut/i.test(delta),
        },
      },
      req,
    );
  }
}

export class GeminiSceneDirector implements SceneDirector {
  readonly id = 'gemini';
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async analyze(req: SceneProcessRequest, signal?: AbortSignal): Promise<SceneDirectorOutput> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: buildSystemInstruction(req) }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: buildUserPrompt(req) }],
          },
        ],
        generationConfig: {
          temperature: 0.35,
          responseMimeType: 'application/json',
        },
      }),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Gemini SceneDirector HTTP ${response.status}: ${errText.slice(0, 300)}`);
    }

    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = payload.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text;
    if (!text) {
      throw new Error('Gemini SceneDirector returned empty response');
    }

    const parsed = SceneDirectorOutputSchema.parse(extractJsonObject(text));
    return postProcessDirectorOutput(parsed, req);
  }
}

export function normalizeOpenAIBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (/\/(api\/)?v1$/i.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}/v1`;
}

export class OpenAISceneDirector implements SceneDirector {
  readonly id: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly useJsonResponseFormat: boolean;

  constructor(
    apiKey: string,
    model: string,
    options: {
      id?: string;
      baseUrl?: string;
      useJsonResponseFormat?: boolean;
    } = {},
  ) {
    this.id = options.id ?? 'openai';
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = normalizeOpenAIBaseUrl(options.baseUrl ?? 'https://api.openai.com/v1');
    this.useJsonResponseFormat = options.useJsonResponseFormat ?? true;
  }

  async analyze(req: SceneProcessRequest, signal?: AbortSignal): Promise<SceneDirectorOutput> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const body: Record<string, unknown> = {
      model: this.model,
      temperature: 0.35,
      messages: [
        { role: 'system', content: buildSystemInstruction(req) },
        { role: 'user', content: buildUserPrompt(req) },
      ],
    };
    if (this.useJsonResponseFormat) {
      body.response_format = { type: 'json_object' };
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`${this.id} SceneDirector HTTP ${response.status}: ${errText.slice(0, 300)}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = payload.choices?.[0]?.message?.content;
    if (!text) {
      throw new Error(`${this.id} SceneDirector returned empty response`);
    }

    const parsed = SceneDirectorOutputSchema.parse(extractJsonObject(text));
    return postProcessDirectorOutput(parsed, req);
  }
}

export function createSceneDirector(config: AppConfig): SceneDirector {
  const fallback = new HeuristicMockDirector();
  let primary: SceneDirector = fallback;

  if (config.resolvedLlmProvider === 'gemini' && config.GEMINI_API_KEY) {
    primary = new GeminiSceneDirector(config.GEMINI_API_KEY, config.GEMINI_LLM_MODEL);
  } else if (config.resolvedLlmProvider === 'lemonade' && config.LEMONADE_LLM_MODEL) {
    primary = new OpenAISceneDirector(config.LEMONADE_API_KEY, config.LEMONADE_LLM_MODEL, {
      id: 'lemonade',
      baseUrl: config.LEMONADE_BASE_URL,
      useJsonResponseFormat: false,
    });
  } else if (config.resolvedLlmProvider === 'openai' && config.OPENAI_API_KEY) {
    primary = new OpenAISceneDirector(config.OPENAI_API_KEY, config.OPENAI_LLM_MODEL);
  }

  if (primary === fallback) {
    return fallback;
  }

  return {
    id: primary.id,
    async analyze(req, signal) {
      try {
        return await primary.analyze(req, signal);
      } catch (err) {
        console.warn(`[SceneDirector] Primary (${primary.id}) failed, falling back to heuristic:`, err);
        return fallback.analyze(req);
      }
    },
  };
}
