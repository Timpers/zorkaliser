import type { CatalogEntry } from './schemas.js';

/**
 * Curated free/openly redistributable interactive fiction titles hosted on the IF Archive.
 * Commercial Infocom titles are never bundled or hosted; players can load their own
 * .z1-.z8/.zblorb story files directly in the browser.
 */
export const FREE_STORY_CATALOG: CatalogEntry[] = [
  {
    id: '905',
    title: '9:05',
    author: 'Adam Cadre',
    year: 2000,
    format: 'Z-code v5',
    difficulty: 'Introductory',
    description:
      'A crisp, celebrated five-minute interactive fiction classic. Wake up to a ringing phone and discover all is not quite as it seems.',
    recommendedStyle: 'photoreal',
    url: 'https://ifarchive.org/if-archive/games/zcode/905.z5',
  },
  {
    id: 'advent',
    title: 'Colossal Cave Adventure',
    author: 'Will Crowther & Don Woods (Inform port)',
    year: 1977,
    format: 'Z-code v5',
    difficulty: 'Classic',
    description:
      'The original granddaddy of text adventures. Explore a sprawling subterranean cave system filled with treasures, puzzles, and magic words.',
    recommendedStyle: 'fantasy-oil',
    url: 'https://ifarchive.org/if-archive/games/zcode/Advent.z5',
  },
  {
    id: 'lost-pig',
    title: 'Lost Pig',
    author: 'Admiral Jota',
    year: 2007,
    format: 'Z-code v8',
    difficulty: 'Introductory',
    description:
      'Play as Grunk, a lovable orc searching underground ruins for a runaway pig. Warm, funny, and richly illustrated by every turn.',
    recommendedStyle: 'cartoon',
    url: 'https://ifarchive.org/if-archive/games/zcode/LostPig.z8',
  },
  {
    id: 'photopia',
    title: 'Photopia',
    author: 'Adam Cadre',
    year: 1998,
    format: 'Z-code v5',
    difficulty: 'Introductory',
    description:
      'A vivid, color-themed narrative journey spanning surreal dreamscapes, spaceflight, and quiet nocturnal roads.',
    recommendedStyle: 'watercolor',
    url: 'https://ifarchive.org/if-archive/games/zcode/photopia.z5',
  },
  {
    id: 'curses',
    title: 'Curses',
    author: 'Graham Nelson',
    year: 1993,
    format: 'Z-code v5',
    difficulty: 'Challenging',
    description:
      'An expansive Infocom-scale puzzle epic set in an eccentric English country manor, its attic, and ancient realms beyond.',
    recommendedStyle: 'gothic-ink',
    url: 'https://ifarchive.org/if-archive/games/zcode/curses.z5',
  },
];
