import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SceneProcessRequest } from '@zorkaliser/shared';
import { HeuristicMockDirector, OpenAISceneDirector } from './sceneDirector.js';

function makeRequest(overrides: Partial<SceneProcessRequest> = {}): SceneProcessRequest {
  return {
    sessionId: 'sess-1',
    storyId: 'zork1-test',
    storyTitle: 'Zork I',
    stylePresetId: 'fantasy-oil',
    reactivityMode: 'dynamic',
    aspectRatio: '16:9',
    quality: 'fast',
    turn: {
      turnIndex: 0,
      command: '',
      statusBarRoomTitle: 'West of House',
      narrativeDelta:
        'West of House\nYou are standing in an open field west of a white house, with a boarded front door.\nThere is a small mailbox here.',
    },
    roomMemory: {
      previousLocationKey: null,
      knownBaseDescription: null,
      previousStateTags: [],
    },
    ...overrides,
  };
}

describe('HeuristicMockDirector', () => {
  const director = new HeuristicMockDirector();

  it('generates on opening scene and extracts locationKey', async () => {
    const out = await director.analyze(makeRequest());
    expect(out.shouldGenerate).toBe(true);
    expect(out.changeType).toBe('new_location');
    expect(out.locationKey).toBe('west_of_house');
    expect(out.displayTitle).toBe('West of House');
    expect(out.imagePrompt).toContain('West of House');
    expect(out.imagePrompt).toContain('oil painting');
  });

  it('detects major architectural state change in dynamic mode (opening trapdoor) but ignores item pickups', async () => {
    const trapdoor = await director.analyze(
      makeRequest({
        reactivityMode: 'dynamic',
        turn: {
          turnIndex: 1,
          command: 'open trapdoor',
          statusBarRoomTitle: 'Living Room',
          narrativeDelta: 'The door reluctantly opens to reveal a rickety staircase descending into darkness.',
        },
        roomMemory: {
          previousLocationKey: 'living_room',
          knownBaseDescription: 'You are in the living room. There is a trophy case and a wooden door.',
          previousStateTags: [],
        },
      }),
    );

    expect(trapdoor.shouldGenerate).toBe(true);
    expect(trapdoor.changeType).toBe('major_state_change');
    expect(trapdoor.stateTags).toContain('door:open');
    expect(trapdoor.updatedBaseDescription).toContain('living room');

    // Taking an item must NOT trigger a re-render even in dynamic mode
    const takeItem = await director.analyze(
      makeRequest({
        reactivityMode: 'dynamic',
        turn: {
          turnIndex: 2,
          command: 'take lamp',
          statusBarRoomTitle: 'Living Room',
          narrativeDelta: 'Taken.',
        },
        roomMemory: {
          previousLocationKey: 'living_room',
          knownBaseDescription: 'You are in the living room.',
          previousStateTags: [],
        },
      }),
    );
    expect(takeItem.shouldGenerate).toBe(false);
  });

  it('skips same-room changes and clears stateTags when reactivityMode is location_only', async () => {
    const out = await director.analyze(
      makeRequest({
        reactivityMode: 'location_only',
        turn: {
          turnIndex: 1,
          command: 'open trapdoor',
          statusBarRoomTitle: 'Living Room',
          narrativeDelta: 'Opening the trapdoor reveals a staircase.',
        },
        roomMemory: {
          previousLocationKey: 'living_room',
          knownBaseDescription: 'You are in the living room.',
          previousStateTags: [],
        },
      }),
    );

    expect(out.shouldGenerate).toBe(false);
    expect(out.changeType).toBe('no_visual_change');
    expect(out.stateTags).toEqual([]);
  });

  it('skips visually insignificant turns in the same room', async () => {
    const out = await director.analyze(
      makeRequest({
        turn: {
          turnIndex: 2,
          command: 'read leaflet',
          statusBarRoomTitle: 'West of House',
          narrativeDelta: '"WELCOME TO ZORK! ZORK is a game of adventure, danger, and low cunning."',
        },
        roomMemory: {
          previousLocationKey: 'west_of_house',
          knownBaseDescription: 'Open field west of a white house.',
          previousStateTags: ['mailbox:open'],
        },
      }),
    );

    expect(out.shouldGenerate).toBe(false);
    expect(out.changeType).toBe('no_visual_change');
  });

  it('detects pitch black darkness and maps to __darkness__', async () => {
    const out = await director.analyze(
      makeRequest({
        turn: {
          turnIndex: 5,
          command: 'down',
          statusBarRoomTitle: 'Cellar',
          narrativeDelta: 'It is pitch black. You are likely to be eaten by a grue.',
        },
        roomMemory: {
          previousLocationKey: 'living_room',
          knownBaseDescription: 'You are in the living room.',
          previousStateTags: [],
        },
      }),
    );

    expect(out.shouldGenerate).toBe(true);
    expect(out.changeType).toBe('darkness');
    expect(out.locationKey).toBe('__darkness__');
    expect(out.displayTitle).toBe('Pitch Black');
  });
});

describe('OpenAISceneDirector (Lemonade local mode)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls custom Lemonade baseUrl and strips markdown JSON fences cleanly', async () => {
    const fenced = '```json\n' + JSON.stringify({
      shouldGenerate: true,
      changeType: 'new_location',
      locationKey: 'west_of_house',
      displayTitle: 'West of House',
      updatedBaseDescription: 'An open field west of a white house.',
      stateTags: ['door:boarded'],
      imagePrompt: 'First-person oil painting of a white house in an open field.',
      negativePrompt: 'text',
      paletteHint: '#d97706',
    }) + '\n```';

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: fenced } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const director = new OpenAISceneDirector('lemonade', 'Qwen3-8B', {
      id: 'lemonade',
      baseUrl: 'http://192.168.0.64:13305',
      useJsonResponseFormat: false,
    });

    const out = await director.analyze(makeRequest({ reactivityMode: 'location_only' }));
    expect(fetchSpy.mock.calls[0][0]).toBe('http://192.168.0.64:13305/v1/chat/completions');
    expect(out.locationKey).toBe('west_of_house');
    expect(out.stateTags).toEqual([]); // Cleared in location_only mode
  });
});
