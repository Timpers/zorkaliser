import { create } from 'zustand';
import {
  createEmptyMapGraph,
  type AspectRatio,
  type GameMapGraph,
  type QualityTier,
  type ReactivityMode,
  type SceneAssetMetadata,
  type SceneDirectorOutput,
} from '@zorkaliser/shared';
import type { RenderedParagraph } from '../engine/glkTypes.js';
import type { StoryHeaderInfo } from '../engine/storyFingerprint.js';
import type { StoredRoomMemory } from '../engine/turnObserver.js';

export type ReaderTheme = 'midnight' | 'parchment' | 'sepia' | 'crt';
export type ReaderFont = 'serif' | 'sans' | 'mono';
export type LeftPaneMode = 'art' | 'split' | 'map';

export interface AutoWalkStatus {
  targetTitle: string;
  remainingSteps: number;
  notice?: string;
}

export interface ActiveStorySession {
  sessionId: string;
  title: string;
  filename: string;
  header: StoryHeaderInfo;
  bytes: Uint8Array;
}

export interface PendingFilePrompt {
  mode: 'save' | 'restore';
  resolve: (
    result: {
      filename: string;
      bytes?: Uint8Array;
      roomMemory?: StoredRoomMemory[];
      mapGraph?: GameMapGraph;
    } | null,
  ) => void;
}

export interface GameState {
  // Active story & VM UI state
  story: ActiveStorySession | null;
  statusLines: string[];
  paragraphs: RenderedParagraph[];
  inputMode: 'line' | 'char' | 'disabled';
  activeInputWindowId: number | null;
  commandHistory: string[];
  vmError: string | null;

  // Visual style & generation settings
  stylePresetId: string;
  customStylePrompt: string;
  reactivityMode: ReactivityMode;
  aspectRatio: AspectRatio;
  quality: QualityTier;

  // Visual stage state
  currentScene: SceneAssetMetadata | null;
  previousSceneUrl: string | null;
  lastDirectorOutput: SceneDirectorOutput | null;
  variationsByCacheKey: Record<string, SceneAssetMetadata[]>;
  activeVariationIndex: number;
  gallery: SceneAssetMetadata[];
  generationStage: 'idle' | 'analyzing' | 'generating' | 'saving';
  generationMessage: string;
  activeJobId: string | null;
  visualError: string | null;

  // Reader appearance & layout
  readerTheme: ReaderTheme;
  readerFont: ReaderFont;
  fontSizePx: number;
  showVisualStage: boolean;
  leftPaneMode: LeftPaneMode;
  pendingFilePrompt: PendingFilePrompt | null;

  // Phase 2: Interactive Auto-Map
  mapGraph: GameMapGraph | null;
  autoWalkStatus: AutoWalkStatus | null;

  // Actions
  startSession: (session: ActiveStorySession, initialMap?: GameMapGraph | null) => void;
  clearSession: () => void;
  setStatusLines: (lines: string[]) => void;
  appendParagraphs: (items: RenderedParagraph[], clear?: boolean) => void;
  setInputState: (mode: 'line' | 'char' | 'disabled', windowId: number | null) => void;
  pushCommandHistory: (cmd: string) => void;
  setVmError: (err: string | null) => void;

  setStyleSettings: (patch: {
    stylePresetId?: string;
    customStylePrompt?: string;
    reactivityMode?: ReactivityMode;
    aspectRatio?: AspectRatio;
    quality?: QualityTier;
  }) => void;
  setReaderSettings: (patch: {
    readerTheme?: ReaderTheme;
    readerFont?: ReaderFont;
    fontSizePx?: number;
    showVisualStage?: boolean;
  }) => void;

  setGenerationStatus: (
    stage: 'idle' | 'analyzing' | 'generating' | 'saving',
    message?: string,
    jobId?: string | null,
  ) => void;
  setLastDirectorOutput: (out: SceneDirectorOutput | null) => void;
  applySceneAsset: (asset: SceneAssetMetadata) => void;
  selectVariation: (index: number) => void;
  selectGalleryScene: (asset: SceneAssetMetadata) => void;
  setVisualError: (err: string | null) => void;
  setPendingFilePrompt: (prompt: PendingFilePrompt | null) => void;
  setLeftPaneMode: (mode: LeftPaneMode) => void;
  setMapGraph: (graph: GameMapGraph | null) => void;
  updateMapGraph: (updater: (current: GameMapGraph) => GameMapGraph) => void;
  setAutoWalkStatus: (status: AutoWalkStatus | null) => void;
}

export const useGameStore = create<GameState>((set, get) => ({
  story: null,
  statusLines: [],
  paragraphs: [],
  inputMode: 'disabled',
  activeInputWindowId: null,
  commandHistory: [],
  vmError: null,

  stylePresetId: 'fantasy-oil',
  customStylePrompt: '',
  reactivityMode: 'location_only',
  aspectRatio: '16:9',
  quality: 'fast',

  currentScene: null,
  previousSceneUrl: null,
  lastDirectorOutput: null,
  variationsByCacheKey: {},
  activeVariationIndex: 0,
  gallery: [],
  generationStage: 'idle',
  generationMessage: '',
  activeJobId: null,
  visualError: null,

  readerTheme: 'midnight',
  readerFont: 'serif',
  fontSizePx: 17,
  showVisualStage: true,
  leftPaneMode: 'art',
  pendingFilePrompt: null,
  mapGraph: null,
  autoWalkStatus: null,

  startSession: (session, initialMap) =>
    set({
      story: session,
      statusLines: [],
      paragraphs: [],
      inputMode: 'disabled',
      activeInputWindowId: null,
      commandHistory: [],
      vmError: null,
      currentScene: null,
      previousSceneUrl: null,
      lastDirectorOutput: null,
      variationsByCacheKey: {},
      activeVariationIndex: 0,
      gallery: [],
      generationStage: 'idle',
      generationMessage: '',
      activeJobId: null,
      visualError: null,
      mapGraph: initialMap ?? createEmptyMapGraph(session.header.storyId),
      autoWalkStatus: null,
    }),

  clearSession: () =>
    set({
      story: null,
      statusLines: [],
      paragraphs: [],
      inputMode: 'disabled',
      activeInputWindowId: null,
      vmError: null,
      generationStage: 'idle',
      activeJobId: null,
      mapGraph: null,
      autoWalkStatus: null,
    }),

  setStatusLines: (lines) => set({ statusLines: lines }),

  appendParagraphs: (items, clear = false) =>
    set((state) => ({
      paragraphs: clear ? items : [...state.paragraphs, ...items].slice(-400),
    })),

  setInputState: (mode, windowId) => set({ inputMode: mode, activeInputWindowId: windowId }),

  pushCommandHistory: (cmd) =>
    set((state) => {
      const trimmed = cmd.trim();
      if (!trimmed) return state;
      const next =
        state.commandHistory[state.commandHistory.length - 1] === trimmed
          ? state.commandHistory
          : [...state.commandHistory, trimmed].slice(-100);
      return { commandHistory: next };
    }),

  setVmError: (err) => set({ vmError: err }),

  setStyleSettings: (patch) => set((state) => ({ ...state, ...patch })),

  setReaderSettings: (patch) => set((state) => ({ ...state, ...patch })),

  setGenerationStatus: (stage, message = '', jobId = null) =>
    set({
      generationStage: stage,
      generationMessage: message,
      activeJobId: jobId,
      ...(stage !== 'idle' ? { visualError: null } : {}),
    }),

  setLastDirectorOutput: (out) => set({ lastDirectorOutput: out }),

  applySceneAsset: (asset) => {
    const prev = get().currentScene;
    const prevVariations = get().variationsByCacheKey[asset.cacheKey] ?? [];
    const existsIdx = prevVariations.findIndex((v) => v.imageUrl === asset.imageUrl);
    const updatedVariations =
      existsIdx >= 0 ? prevVariations : [...prevVariations, asset];
    const activeIdx = existsIdx >= 0 ? existsIdx : updatedVariations.length - 1;

    const existingGallery = get().gallery;
    const galleryFiltered = existingGallery.filter((g) => g.imageUrl !== asset.imageUrl);

    set({
      previousSceneUrl: prev?.imageUrl ?? null,
      currentScene: asset,
      variationsByCacheKey: {
        ...get().variationsByCacheKey,
        [asset.cacheKey]: updatedVariations,
      },
      activeVariationIndex: activeIdx,
      gallery: [asset, ...galleryFiltered].slice(0, 60),
      generationStage: 'idle',
      generationMessage: '',
      activeJobId: null,
      visualError: null,
    });
  },

  selectVariation: (index) => {
    const current = get().currentScene;
    if (!current) return;
    const list = get().variationsByCacheKey[current.cacheKey] ?? [];
    const target = list[index];
    if (!target) return;
    set({
      previousSceneUrl: current.imageUrl,
      currentScene: target,
      activeVariationIndex: index,
    });
  },

  selectGalleryScene: (asset) => {
    const current = get().currentScene;
    const list = get().variationsByCacheKey[asset.cacheKey] ?? [asset];
    const idx = Math.max(
      0,
      list.findIndex((v) => v.imageUrl === asset.imageUrl),
    );
    set({
      previousSceneUrl: current?.imageUrl ?? null,
      currentScene: asset,
      activeVariationIndex: idx,
    });
  },

  setVisualError: (err) =>
    set({
      visualError: err,
      generationStage: 'idle',
      generationMessage: '',
      activeJobId: null,
    }),

  setPendingFilePrompt: (prompt) => set({ pendingFilePrompt: prompt }),

  setLeftPaneMode: (mode) => set({ leftPaneMode: mode, showVisualStage: true }),

  setMapGraph: (graph) => set({ mapGraph: graph }),

  updateMapGraph: (updater) =>
    set((state) => {
      if (!state.mapGraph) return state;
      return { mapGraph: updater(state.mapGraph) };
    }),

  setAutoWalkStatus: (status) => set({ autoWalkStatus: status }),
}));
