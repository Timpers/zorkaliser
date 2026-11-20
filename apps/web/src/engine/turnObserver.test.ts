import { describe, expect, it, vi } from 'vitest';
import {
  TurnObserver,
  isNonVisualTurn,
  parseStatusLineRoomTitle,
} from './turnObserver.js';
import type { TurnSnapshot } from './glkTypes.js';

function makeTurn(overrides: Partial<TurnSnapshot> = {}): TurnSnapshot {
  return {
    turnIndex: 1,
    command: 'north',
    statusLines: [' North of House                                  Score: 0        Moves: 2 '],
    statusRoomTitle: 'North of House',
    narrativeDelta: 'North of House\nYou are facing the north side of a white house.',
    ...overrides,
  };
}

describe('parseStatusLineRoomTitle', () => {
  it('extracts room title from classic Infocom status bars', () => {
    expect(
      parseStatusLineRoomTitle([' West of House                                    Score: 0        Moves: 1 ']),
    ).toBe('West of House');
    expect(parseStatusLineRoomTitle([' Kitchen                   10/42'])).toBe('Kitchen');
    expect(parseStatusLineRoomTitle([' Bedroom                   9:05 am'])).toBe('Bedroom');
  });
});

describe('isNonVisualTurn', () => {
  it('skips meta commands and parser errors in the same room', () => {
    expect(
      isNonVisualTurn(
        makeTurn({
          command: 'score',
          statusRoomTitle: 'West of House',
          narrativeDelta: 'Your score is 0 (total of 350 points), in 2 moves.',
        }),
        'west_of_house',
      ).skip,
    ).toBe(true);

    expect(
      isNonVisualTurn(
        makeTurn({
          command: 'xyzzy',
          statusRoomTitle: 'West of House',
          narrativeDelta: "I don't know the word \"xyzzy\".",
        }),
        'west_of_house',
      ).skip,
    ).toBe(true);
  });

  it('skips item pickups and same-room interactions in location_only mode, but reveals room when lighting lamp in darkness', () => {
    const takeResult = isNonVisualTurn(
      makeTurn({
        command: 'take leaflet',
        statusRoomTitle: 'West of House',
        narrativeDelta: 'Taken.',
      }),
      'west_of_house',
      'location_only',
    );
    expect(takeResult.skip).toBe(true);
    expect(takeResult.reason).toBe('same_location');

    // Lighting a lamp while previously in '__darkness__' must NOT be skipped
    const lampResult = isNonVisualTurn(
      makeTurn({
        command: 'turn on lamp',
        statusRoomTitle: 'Cellar',
        narrativeDelta: 'The brass lantern is now on.\nCellar\nYou are in a dark and damp cellar.',
      }),
      '__darkness__',
      'location_only',
    );
    expect(lampResult.skip).toBe(false);
  });

  it('never skips room changes or darkness transitions', () => {
    expect(
      isNonVisualTurn(
        makeTurn({
          command: 'north',
          statusRoomTitle: 'North of House',
          narrativeDelta: 'North of House',
        }),
        'west_of_house',
      ).skip,
    ).toBe(false);

    expect(
      isNonVisualTurn(
        makeTurn({
          command: 'down',
          statusRoomTitle: 'Cellar',
          narrativeDelta: 'It is pitch black. You are likely to be eaten by a grue.',
        }),
        'cellar',
      ).skip,
    ).toBe(false);
  });
});

describe('TurnObserver', () => {
  it('debounces rapid speed-walking and only dispatches the final room', async () => {
    vi.useFakeTimers();
    const observer = new TurnObserver(450);
    const dispatched: TurnSnapshot[] = [];

    observer.observeTurn(
      makeTurn({ turnIndex: 1, command: 'n', statusRoomTitle: 'North of House' }),
      (t) => dispatched.push(t),
    );
    vi.advanceTimersByTime(150);
    observer.observeTurn(
      makeTurn({ turnIndex: 2, command: 'e', statusRoomTitle: 'Behind House' }),
      (t) => dispatched.push(t),
    );
    vi.advanceTimersByTime(150);
    observer.observeTurn(
      makeTurn({ turnIndex: 3, command: 'in', statusRoomTitle: 'Kitchen' }),
      (t) => dispatched.push(t),
    );

    expect(dispatched).toHaveLength(0);
    vi.advanceTimersByTime(450);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].statusRoomTitle).toBe('Kitchen');
    vi.useRealTimers();
  });

  it('retains BRIEF-mode room descriptions when revisiting an earlier location', () => {
    const observer = new TurnObserver(0);
    observer.recordDirectorResult({
      locationKey: 'west_of_house',
      displayTitle: 'West of House',
      updatedBaseDescription: 'An open field west of a white house with a boarded front door.',
      stateTags: ['mailbox:open'],
    });
    observer.recordDirectorResult({
      locationKey: 'north_of_house',
      displayTitle: 'North of House',
      updatedBaseDescription: 'Facing the north side of a white house.',
      stateTags: [],
    });

    let capturedBase: string | null = null;
    observer.observeTurn(
      makeTurn({
        turnIndex: 4,
        command: 'sw',
        statusRoomTitle: 'West of House',
        narrativeDelta: 'West of House', // BRIEF mode omits full text!
      }),
      (_turn, mem) => {
        capturedBase = mem.knownBaseDescription;
      },
      { immediate: true },
    );

    expect(capturedBase).toContain('boarded front door');
  });
});
