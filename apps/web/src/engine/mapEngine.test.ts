import { describe, expect, it } from 'vitest';
import { createEmptyMapGraph } from '@zorkaliser/shared';
import {
  MAP_GRID_STEP_X,
  MAP_GRID_STEP_Y,
  applyDirectorHintsToMap,
  applyTurnToMap,
  attachArtworkToMap,
  parseMovementCommand,
  splitCurrentRoomAsMazeNode,
} from './mapEngine.js';
import type { TurnSnapshot } from './glkTypes.js';

function makeTurn(overrides: Partial<TurnSnapshot> = {}): TurnSnapshot {
  return {
    turnIndex: 0,
    command: '',
    statusLines: [],
    statusRoomTitle: 'West of House',
    narrativeDelta:
      'West of House\nYou are standing in an open field west of a white house. There is a path leading north and south.',
    ...overrides,
  };
}

describe('parseMovementCommand', () => {
  it('parses abbreviations, full compass words, and multi-word travel verbs', () => {
    expect(parseMovementCommand('n')).toBe('n');
    expect(parseMovementCommand('go northeast')).toBe('ne');
    expect(parseMovementCommand('walk south')).toBe('s');
    expect(parseMovementCommand('climb up')).toBe('u');
    expect(parseMovementCommand('down')).toBe('d');
    expect(parseMovementCommand('enter house')).toBe('in');
    expect(parseMovementCommand('leave')).toBe('out');
    expect(parseMovementCommand('open mailbox')).toBeNull();
  });
});

describe('applyTurnToMap', () => {
  it('places rooms at compass offsets, upgrades bidirectional edges, and handles floor elevation', () => {
    let g = createEmptyMapGraph('zork1');

    // Turn 0: West of House at (0, 0, level 0)
    g = applyTurnToMap(g, makeTurn());
    expect(g.currentNodeId).toBe('west_of_house');
    expect(g.nodes.west_of_house.position).toEqual({ x: 0, y: 0 });
    expect(g.nodes.west_of_house.unexploredExits).toContain('n');
    expect(g.nodes.west_of_house.unexploredExits).toContain('s');

    // Turn 1: Move north -> North of House at (0, -MAP_GRID_STEP_Y)
    g = applyTurnToMap(
      g,
      makeTurn({
        turnIndex: 1,
        command: 'n',
        statusRoomTitle: 'North of House',
        narrativeDelta: 'North of House\nYou are facing the north side of a white house.',
      }),
    );
    expect(g.currentNodeId).toBe('north_of_house');
    expect(g.nodes.north_of_house.position).toEqual({ x: 0, y: -MAP_GRID_STEP_Y });
    expect(g.nodes.west_of_house.unexploredExits).not.toContain('n');

    // Turn 2: Return south -> upgrades existing edge to bidirectional
    g = applyTurnToMap(
      g,
      makeTurn({
        turnIndex: 2,
        command: 'south',
        statusRoomTitle: 'West of House',
        narrativeDelta: 'West of House',
      }),
    );
    expect(g.currentNodeId).toBe('west_of_house');
    const edge = Object.values(g.edges).find(
      (e) => e.fromNodeId === 'west_of_house' && e.toNodeId === 'north_of_house',
    );
    expect(edge?.bidirectional).toBe(true);

    // Turn 3: Go down -> Cellar at level -1
    g = applyTurnToMap(
      g,
      makeTurn({
        turnIndex: 3,
        command: 'd',
        statusRoomTitle: 'Cellar',
        narrativeDelta: 'Cellar\nYou are in a dark and damp cellar.',
      }),
    );
    expect(g.nodes.cellar.level).toBe(-1);
    expect(g.activeLevel).toBe(-1);
  });

  it('records locked edges and prunes invalid unexplored stubs on "You can\'t go that way"', () => {
    let g = createEmptyMapGraph('zork1');
    g = applyTurnToMap(g, makeTurn());

    g = applyTurnToMap(
      g,
      makeTurn({
        turnIndex: 1,
        command: 'e',
        statusRoomTitle: 'West of House',
        narrativeDelta: 'The door is boarded and locked.',
      }),
    );
    const locked = Object.values(g.edges).find((e) => e.status === 'locked');
    expect(locked?.direction).toBe('e');

    g = applyTurnToMap(
      g,
      makeTurn({
        turnIndex: 2,
        command: 'n',
        statusRoomTitle: 'West of House',
        narrativeDelta: "You can't go that way.",
      }),
    );
    expect(g.nodes.west_of_house.unexploredExits).not.toContain('n');
  });

  it('resolves grid collisions, attaches Phase 1 artwork, merges LLM hints, and splits maze nodes', () => {
    let g = createEmptyMapGraph('zork1');
    g = applyTurnToMap(g, makeTurn({ statusRoomTitle: 'Room A', narrativeDelta: 'Room A' }));
    g = applyTurnToMap(
      g,
      makeTurn({ turnIndex: 1, command: 'e', statusRoomTitle: 'Room B', narrativeDelta: 'Room B' }),
    );
    // Moving west from Room B into a *different* Room C would collide with Room A at (0,0)
    g = applyTurnToMap(
      g,
      makeTurn({ turnIndex: 2, command: 'w', statusRoomTitle: 'Room C', narrativeDelta: 'Room C' }),
    );
    expect(g.nodes.room_c.position.x).not.toBe(0);
    expect(g.nodes.room_c.position.x).toBe(-MAP_GRID_STEP_X);

    g = attachArtworkToMap(g, 'room_c', '/api/assets/room_c.png');
    expect(g.nodes.room_c.thumbnailUrl).toBe('/api/assets/room_c.png');

    g = applyDirectorHintsToMap(g, {
      shouldGenerate: true,
      changeType: 'new_location',
      locationKey: 'room_c',
      displayTitle: 'Room C',
      updatedBaseDescription: 'A twisting stone passage.',
      stateTags: [],
      imagePrompt: '...',
      negativePrompt: '',
      mapHints: { mentionedExits: ['north', 'southeast'] },
    });
    expect(g.nodes.room_c.unexploredExits).toEqual(expect.arrayContaining(['n', 'se']));

    g = splitCurrentRoomAsMazeNode(g);
    expect(g.currentNodeId).toBe('room_c__2');
    expect(g.nodes.room_c__2.title).toContain('#2');
  });
});
