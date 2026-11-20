import { describe, expect, it } from 'vitest';
import { createEmptyMapGraph, type GameMapGraph } from '@zorkaliser/shared';
import { findShortestWalkPath } from './mapPathfinder.js';

function buildSampleGraph(): GameMapGraph {
  const g = createEmptyMapGraph('test-story');
  g.nodes = {
    a: {
      id: 'a',
      locationKey: 'a',
      title: 'West of House',
      level: 0,
      position: { x: 0, y: 0 },
      positionLocked: false,
      visited: true,
      isDark: false,
      unexploredExits: [],
      userNotes: '',
    },
    b: {
      id: 'b',
      locationKey: 'b',
      title: 'North of House',
      level: 0,
      position: { x: 0, y: -150 },
      positionLocked: false,
      visited: true,
      isDark: false,
      unexploredExits: [],
      userNotes: '',
    },
    c: {
      id: 'c',
      locationKey: 'c',
      title: 'Behind House',
      level: 0,
      position: { x: 220, y: -150 },
      positionLocked: false,
      visited: true,
      isDark: false,
      unexploredExits: [],
      userNotes: '',
    },
    d: {
      id: 'd',
      locationKey: 'd',
      title: 'Cellar',
      level: -1,
      position: { x: 220, y: -150 },
      positionLocked: false,
      visited: true,
      isDark: false,
      unexploredExits: [],
      userNotes: '',
    },
  };
  g.edges = {
    ab: {
      id: 'ab',
      fromNodeId: 'a',
      toNodeId: 'b',
      direction: 'n',
      bidirectional: true,
      status: 'open',
    },
    bc: {
      id: 'bc',
      fromNodeId: 'b',
      toNodeId: 'c',
      direction: 'e',
      bidirectional: true,
      status: 'open',
    },
    ac_locked: {
      id: 'ac_locked',
      fromNodeId: 'a',
      toNodeId: 'c',
      direction: 'e',
      bidirectional: true,
      status: 'locked',
    },
    cd_oneway: {
      id: 'cd_oneway',
      fromNodeId: 'c',
      toNodeId: 'd',
      direction: 'd',
      bidirectional: false,
      status: 'one_way',
    },
  };
  return g;
}

describe('findShortestWalkPath', () => {
  it('finds shortest open path while avoiding locked doors and supports reverse bidirectional travel', () => {
    const g = buildSampleGraph();

    const forward = findShortestWalkPath(g, 'a', 'c');
    expect(forward?.steps.map((s) => s.command)).toEqual(['north', 'east']);

    const backward = findShortestWalkPath(g, 'c', 'a');
    expect(backward?.steps.map((s) => s.command)).toEqual(['west', 'south']);
  });

  it('refuses to route backwards up a one-way chute or into non-open edges', () => {
    const g = buildSampleGraph();
    expect(findShortestWalkPath(g, 'd', 'c')).toBeNull();
    expect(findShortestWalkPath(g, 'a', 'd')).toBeNull();
  });
});
