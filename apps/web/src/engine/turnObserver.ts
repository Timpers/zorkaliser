import { normalizeLocationKey, type ReactivityMode } from '@zorkaliser/shared';
import type { TurnSnapshot } from './glkTypes.js';

export interface StoredRoomMemory {
  locationKey: string;
  displayTitle: string;
  baseDescription: string;
  stateTags: string[];
}

const META_COMMANDS = new Set([
  'save',
  'restore',
  'restart',
  'quit',
  'q',
  'score',
  'version',
  'verbose',
  'brief',
  'superbrief',
  'script',
  'unscript',
  'transcript',
  'undo',
  'help',
  'about',
  'credits',
  'hints',
  'hint',
  'i',
  'inv',
  'inventory',
  'diagnose',
]);

const PARSER_REJECTION_PATTERNS = [
  /^i don't (know|understand) the word/i,
  /^that's not a verb i recognize/i,
  /^i didn't understand that sentence/i,
  /^you can't go that way/i,
  /^you can't see any such thing/i,
  /^i beg your pardon\??$/i,
  /^what do you want to /i,
  /^time passes\.?$/i,
  /^ok\.?$/i,
  /^done\.?$/i,
  /^nothing happens\.?$/i,
  /^your score (is|would be)/i,
  /^maximum verbosity/i,
  /^brief descriptions/i,
];

const DARKNESS_PATTERNS = [
  /it is pitch black/i,
  /too dark to see/i,
  /likely to be eaten by a grue/i,
];

export function isNonVisualTurn(
  turn: TurnSnapshot,
  previousLocationKey: string | null,
  reactivityMode: ReactivityMode = 'location_only',
): { skip: boolean; reason?: string } {
  // Opening banner/room should never be skipped
  if (turn.turnIndex === 0) {
    return { skip: false };
  }

  const trimmedDelta = turn.narrativeDelta.trim();
  if (!trimmedDelta) {
    return { skip: true, reason: 'empty_output' };
  }

  // Never skip if the room transitioned into darkness
  if (DARKNESS_PATTERNS.some((p) => p.test(trimmedDelta))) {
    return { skip: false };
  }

  const normalizedRoom = turn.statusRoomTitle
    ? normalizeLocationKey(turn.statusRoomTitle)
    : null;
  const roomChanged = Boolean(
    normalizedRoom && previousLocationKey && normalizedRoom !== previousLocationKey,
  );
  if (roomChanged) {
    return { skip: false };
  }

  // In location_only mode, skip any action within the same already-rendered room
  // (e.g., taking/dropping items, examining objects). Lighting a lamp while in
  // '__darkness__' still triggers because previousLocationKey ('__darkness__') !== normalizedRoom.
  if (
    reactivityMode === 'location_only' &&
    normalizedRoom &&
    previousLocationKey &&
    normalizedRoom === previousLocationKey
  ) {
    return { skip: true, reason: 'same_location' };
  }

  const cmd = turn.command.trim().toLowerCase();
  const firstWord = cmd.split(/\s+/)[0] ?? '';
  if (META_COMMANDS.has(cmd) || META_COMMANDS.has(firstWord)) {
    return { skip: true, reason: `meta_command:${firstWord}` };
  }

  if (PARSER_REJECTION_PATTERNS.some((p) => p.test(trimmedDelta))) {
    return { skip: true, reason: 'parser_rejection' };
  }

  return { skip: false };
}

/**
 * Extracts clean room title from classic Infocom/Inform Glk grid status lines.
 * Example: " West of House                                    Score: 0        Moves: 1 "
 */
export function parseStatusLineRoomTitle(statusLines: string[]): string | null {
  for (const rawLine of statusLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // Strip trailing Score / Moves / Turns / Time columns
    const stripped = trimmed
      .replace(/\s{2,}(Score|Moves|Turns|Time|Health|Points)\s*:.*$/i, '')
      .replace(/\s+\d+\s*\/\s*\d+\s*$/, '')
      .replace(/\s+\d{1,2}:\d{2}\s*(am|pm)?\s*$/i, '')
      .trim();

    if (stripped.length >= 2 && stripped.length <= 80 && !/^(score|moves|turns)\b/i.test(stripped)) {
      return stripped;
    }
  }
  return null;
}

export class TurnObserver {
  private readonly debounceMs: number;
  private readonly rooms = new Map<string, StoredRoomMemory>();
  private currentLocationKey: string | null = null;
  private carriedLightSource: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private activeAbort: AbortController | null = null;
  private requestSeq = 0;

  constructor(debounceMs = 450) {
    this.debounceMs = debounceMs;
  }

  reset(initialRooms?: StoredRoomMemory[]): void {
    this.cancelPending();
    this.rooms.clear();
    this.currentLocationKey = null;
    this.carriedLightSource = null;
    if (initialRooms) {
      for (const room of initialRooms) {
        this.rooms.set(room.locationKey, room);
      }
    }
  }

  exportRoomMemory(): StoredRoomMemory[] {
    return Array.from(this.rooms.values());
  }

  getCurrentRoomMemory(): {
    previousLocationKey: string | null;
    knownBaseDescription: string | null;
    previousStateTags: string[];
    carriedLightSource: string | null;
  } {
    const current = this.currentLocationKey ? this.rooms.get(this.currentLocationKey) : undefined;
    return {
      previousLocationKey: this.currentLocationKey,
      knownBaseDescription: current?.baseDescription ?? null,
      previousStateTags: current?.stateTags ?? [],
      carriedLightSource: this.carriedLightSource,
    };
  }

  getRoomMemoryForTitle(title: string | null): StoredRoomMemory | undefined {
    if (!title) return undefined;
    return this.rooms.get(normalizeLocationKey(title));
  }

  recordDirectorResult(result: {
    locationKey: string;
    displayTitle: string;
    updatedBaseDescription: string;
    stateTags: string[];
  }): void {
    this.currentLocationKey = result.locationKey;
    if (result.locationKey !== '__darkness__') {
      const existing = this.rooms.get(result.locationKey);
      this.rooms.set(result.locationKey, {
        locationKey: result.locationKey,
        displayTitle: result.displayTitle,
        baseDescription:
          result.updatedBaseDescription.trim() || existing?.baseDescription || '',
        stateTags: result.stateTags,
      });
    }
  }

  /**
   * Schedules a debounced turn dispatch. Any newer turn within `debounceMs` cancels the previous
   * pending timer and aborts in-flight requests so speed-walking only renders the final room.
   */
  observeTurn(
    turn: TurnSnapshot,
    onDispatch: (
      turn: TurnSnapshot,
      memory: {
        previousLocationKey: string | null;
        knownBaseDescription: string | null;
        previousStateTags: string[];
        carriedLightSource: string | null;
      },
      seq: number,
      signal: AbortSignal,
    ) => void,
    options: {
      immediate?: boolean;
      bypassFilter?: boolean;
      reactivityMode?: ReactivityMode;
    } = {},
  ): { skipped: boolean; reason?: string } {
    if (!options.bypassFilter) {
      const check = isNonVisualTurn(
        turn,
        this.currentLocationKey,
        options.reactivityMode ?? 'location_only',
      );
      if (check.skip) {
        return { skipped: true, reason: check.reason };
      }
    }

    // Track basic light source cues locally
    if (/\b(lamp|lantern|torch)\b.{0,25}\b(now on|lit|glowing)\b/i.test(turn.narrativeDelta)) {
      this.carriedLightSource = 'lit lantern';
    } else if (/\b(lamp|lantern|torch)\b.{0,25}\b(now off|extinguished)\b/i.test(turn.narrativeDelta)) {
      this.carriedLightSource = null;
    }

    this.cancelPending();

    const seq = ++this.requestSeq;
    const controller = new AbortController();
    this.activeAbort = controller;

    const dispatchNow = () => {
      this.timer = null;
      if (controller.signal.aborted) return;

      // If revisiting a known room in BRIEF mode, supply that room's stored description!
      const targetMemory = this.getRoomMemoryForTitle(turn.statusRoomTitle);
      const currentMem = this.getCurrentRoomMemory();
      const mergedMemory = {
        previousLocationKey: currentMem.previousLocationKey,
        knownBaseDescription: targetMemory?.baseDescription ?? currentMem.knownBaseDescription,
        previousStateTags: targetMemory?.stateTags ?? currentMem.previousStateTags,
        carriedLightSource: currentMem.carriedLightSource,
      };
      onDispatch(turn, mergedMemory, seq, controller.signal);
    };

    if (options.immediate || this.debounceMs <= 0) {
      dispatchNow();
    } else {
      this.timer = setTimeout(dispatchNow, this.debounceMs);
    }

    return { skipped: false };
  }

  isLatestSequence(seq: number): boolean {
    return seq === this.requestSeq;
  }

  cancelPending(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.activeAbort) {
      this.activeAbort.abort();
      this.activeAbort = null;
    }
  }
}
