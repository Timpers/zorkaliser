import {
  cancelSceneJob,
  processSceneTurn,
  regenerateScene,
  subscribeToSceneJob,
} from '../services/apiClient.js';
import { getL1SceneCache, putL1SceneCache, putSavedMap } from '../services/storage.js';
import { useGameStore } from '../store/gameStore.js';
import type { TurnSnapshot } from './glkTypes.js';
import { applyDirectorHintsToMap, attachArtworkToMap } from './mapEngine.js';
import { TurnObserver } from './turnObserver.js';

/**
 * Coordinates the TurnObserver, L1 IndexedDB cache, backend Scene Director + SSE image stream,
 * manual regeneration, and mid-game art style switches.
 */
export class SceneController {
  readonly observer = new TurnObserver(450);
  private unsubscribeSse: (() => void) | null = null;
  private lastTurn: TurnSnapshot | null = null;

  reset(): void {
    this.cancelActiveJob();
    this.observer.reset();
    this.lastTurn = null;
  }

  handleTurn(turn: TurnSnapshot): void {
    this.lastTurn = turn;
    const state = useGameStore.getState();
    if (!state.story || state.reactivityMode === 'manual') {
      return;
    }

    this.observer.observeTurn(
      turn,
      (settledTurn, memory, seq, signal) => {
        void this.dispatchScene(settledTurn, memory, seq, signal, false);
      },
      { immediate: turn.turnIndex === 0, reactivityMode: state.reactivityMode },
    );
  }

  /**
   * Forces illustration of the current location (used for Manual mode or after switching styles mid-game).
   */
  illustrateCurrentScene(): void {
    const state = useGameStore.getState();
    if (!state.story) return;

    const fallbackTurn: TurnSnapshot = this.lastTurn ?? {
      turnIndex: 0,
      command: 'look',
      statusLines: state.statusLines,
      statusRoomTitle: state.currentScene?.displayTitle ?? state.lastDirectorOutput?.displayTitle ?? null,
      narrativeDelta:
        state.lastDirectorOutput?.updatedBaseDescription ??
        state.paragraphs
          .slice(-8)
          .map((p) => p.spans.map((s) => s.text).join(''))
          .join('\n'),
    };

    this.observer.observeTurn(
      fallbackTurn,
      (settledTurn, memory, seq, signal) => {
        void this.dispatchScene(settledTurn, memory, seq, signal, true);
      },
      { immediate: true, bypassFilter: true },
    );
  }

  /**
   * Generates a fresh variation of the currently displayed scene.
   */
  async regenerateCurrentScene(): Promise<void> {
    const state = useGameStore.getState();
    if (!state.story || !state.currentScene) return;

    this.cancelActiveJob();
    const scene = state.currentScene;
    state.setGenerationStatus('generating', `Repainting ${scene.displayTitle}...`, null);

    try {
      const res = await regenerateScene({
        sessionId: state.story.sessionId,
        storyId: state.story.header.storyId,
        stylePresetId: state.stylePresetId,
        customStylePrompt: state.stylePresetId === 'custom' ? state.customStylePrompt : undefined,
        aspectRatio: state.aspectRatio,
        quality: state.quality,
        locationKey: scene.locationKey,
        displayTitle: scene.displayTitle,
        stateTags: scene.stateTags,
        imagePrompt: scene.promptUsed,
        negativePrompt: state.lastDirectorOutput?.negativePrompt,
        paletteHint: scene.paletteHint,
      });

      useGameStore
        .getState()
        .setGenerationStatus('generating', `Painting new variation of ${scene.displayTitle}...`, res.jobId);

      this.unsubscribeSse = subscribeToSceneJob(
        res.streamUrl,
        (event) => {
          if (event.type === 'status') {
            useGameStore.getState().setGenerationStatus(event.stage, event.message, event.jobId);
          } else if (event.type === 'completed') {
            void putL1SceneCache(event.asset);
            useGameStore.getState().applySceneAsset(event.asset);
            useGameStore.getState().updateMapGraph((g) => {
              const next = attachArtworkToMap(g, event.asset.locationKey, event.asset.imageUrl);
              void putSavedMap(next);
              return next;
            });
            this.unsubscribeSse = null;
          } else if (event.type === 'failed') {
            useGameStore.getState().setVisualError(event.error);
            this.unsubscribeSse = null;
          }
        },
        (errMsg) => {
          useGameStore.getState().setVisualError(errMsg);
          this.unsubscribeSse = null;
        },
      );
    } catch (err) {
      useGameStore
        .getState()
        .setVisualError(err instanceof Error ? err.message : 'Failed regenerating scene');
    }
  }

  cancelActiveJob(): void {
    this.observer.cancelPending();
    if (this.unsubscribeSse) {
      this.unsubscribeSse();
      this.unsubscribeSse = null;
    }
    const activeJobId = useGameStore.getState().activeJobId;
    if (activeJobId) {
      void cancelSceneJob(activeJobId);
    }
    useGameStore.getState().setGenerationStatus('idle', '', null);
  }

  private async dispatchScene(
    turn: TurnSnapshot,
    memory: {
      previousLocationKey: string | null;
      knownBaseDescription: string | null;
      previousStateTags: string[];
      carriedLightSource: string | null;
    },
    seq: number,
    signal: AbortSignal,
    forceGenerate: boolean,
  ): Promise<void> {
    const state = useGameStore.getState();
    if (!state.story) return;

    if (this.unsubscribeSse) {
      this.unsubscribeSse();
      this.unsubscribeSse = null;
    }

    state.setGenerationStatus('analyzing', 'Reading the scene...', null);

    try {
      const response = await processSceneTurn(
        {
          sessionId: state.story.sessionId,
          storyId: state.story.header.storyId,
          storyTitle: state.story.title,
          stylePresetId: state.stylePresetId,
          customStylePrompt:
            state.stylePresetId === 'custom' ? state.customStylePrompt : undefined,
          reactivityMode: state.reactivityMode === 'location_only' ? 'location_only' : 'dynamic',
          aspectRatio: state.aspectRatio,
          quality: state.quality,
          forceGenerate,
          turn: {
            turnIndex: turn.turnIndex,
            command: turn.command,
            statusBarRoomTitle: turn.statusRoomTitle,
            narrativeDelta: turn.narrativeDelta,
          },
          roomMemory: memory,
        },
        signal,
      );

      if (!this.observer.isLatestSequence(seq) || signal.aborted) return;

      // Always record updated BRIEF-mode memory and enrich Phase 2 Auto-Map with exit hints
      this.observer.recordDirectorResult(response.director);
      useGameStore.getState().setLastDirectorOutput(response.director);
      useGameStore.getState().updateMapGraph((g) => {
        const next = applyDirectorHintsToMap(g, response.director);
        void putSavedMap(next);
        return next;
      });

      if (response.status === 'skipped') {
        useGameStore.getState().setGenerationStatus('idle', '', null);
        return;
      }

      if (response.status === 'hit') {
        void putL1SceneCache(response.asset);
        useGameStore.getState().applySceneAsset(response.asset);
        useGameStore.getState().updateMapGraph((g) => {
          const next = attachArtworkToMap(g, response.asset.locationKey, response.asset.imageUrl);
          void putSavedMap(next);
          return next;
        });
        return;
      }

      // Check browser L1 cache before waiting on SSE (covers rapid local revisits if server cache cleared)
      if (!forceGenerate) {
        const l1 = await getL1SceneCache(response.cacheKey);
        if (l1 && this.observer.isLatestSequence(seq)) {
          useGameStore.getState().applySceneAsset({ ...l1, cacheHit: true });
          useGameStore.getState().updateMapGraph((g) => {
            const next = attachArtworkToMap(g, l1.locationKey, l1.imageUrl);
            void putSavedMap(next);
            return next;
          });
          void cancelSceneJob(response.jobId);
          return;
        }
      }

      useGameStore
        .getState()
        .setGenerationStatus(
          'generating',
          `Illustrating ${response.director.displayTitle}...`,
          response.jobId,
        );

      this.unsubscribeSse = subscribeToSceneJob(
        response.streamUrl,
        (event) => {
          if (!this.observer.isLatestSequence(seq)) return;
          if (event.type === 'status') {
            useGameStore.getState().setGenerationStatus(event.stage, event.message, event.jobId);
          } else if (event.type === 'completed') {
            void putL1SceneCache(event.asset);
            useGameStore.getState().applySceneAsset(event.asset);
            useGameStore.getState().updateMapGraph((g) => {
              const next = attachArtworkToMap(g, event.asset.locationKey, event.asset.imageUrl);
              void putSavedMap(next);
              return next;
            });
            this.unsubscribeSse = null;
          } else if (event.type === 'failed') {
            useGameStore.getState().setVisualError(event.error);
            this.unsubscribeSse = null;
          }
        },
        (errMsg) => {
          if (!this.observer.isLatestSequence(seq)) return;
          useGameStore.getState().setVisualError(errMsg);
          this.unsubscribeSse = null;
        },
      );
    } catch (err) {
      if (signal.aborted || !this.observer.isLatestSequence(seq)) return;
      useGameStore
        .getState()
        .setVisualError(err instanceof Error ? err.message : 'Scene generation request failed');
    }
  }
}
