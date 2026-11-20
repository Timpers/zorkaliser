import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Columns2,
  Image as ImageIcon,
  Map as MapIcon,
  PanelLeftClose,
  PanelLeftOpen,
  Save,
  Settings,
  Sparkles,
} from 'lucide-react';
import { LauncherModal } from './components/LauncherModal.js';
import { MapCanvas } from './components/MapCanvas.js';
import { SaveLoadModal } from './components/SaveLoadModal.js';
import { SettingsModal } from './components/SettingsModal.js';
import { TerminalPane } from './components/TerminalPane.js';
import { VisualStage } from './components/VisualStage.js';
import { BocfelRunner } from './engine/bocfelRunner.js';
import { applyTurnToMap } from './engine/mapEngine.js';
import { findShortestWalkPath, type WalkStep } from './engine/mapPathfinder.js';
import { SceneController } from './engine/sceneController.js';
import { fingerprintStory } from './engine/storyFingerprint.js';
import { fetchHealth, type HealthResponse } from './services/apiClient.js';
import { getSavedMap, putSaveSlot, putSavedMap } from './services/storage.js';
import { useGameStore, type LeftPaneMode } from './store/gameStore.js';

export function App() {
  const {
    story,
    showVisualStage,
    leftPaneMode,
    mapGraph,
    startSession,
    setStatusLines,
    appendParagraphs,
    setInputState,
    setVmError,
    setReaderSettings,
    setPendingFilePrompt,
    setLeftPaneMode,
    setMapGraph,
    updateMapGraph,
    setAutoWalkStatus,
  } = useGameStore();

  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [launcherOpen, setLauncherOpen] = useState(true);
  const [savesOpen, setSavesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [splitPercent, setSplitPercent] = useState(54);

  const runnerRef = useRef<BocfelRunner | null>(null);
  const sceneControllerRef = useRef<SceneController | null>(null);
  const draggingSplitRef = useRef(false);

  // Safe turn-by-turn Click-to-Walk queue
  const walkQueueRef = useRef<{
    targetTitle: string;
    steps: WalkStep[];
    inFlightExpectedNodeId: string | null;
  } | null>(null);

  if (!sceneControllerRef.current) {
    sceneControllerRef.current = new SceneController();
  }

  const stopAutoWalk = useCallback(
    (notice?: string) => {
      walkQueueRef.current = null;
      if (notice) {
        setAutoWalkStatus({ targetTitle: '', remainingSteps: 0, notice });
      } else {
        setAutoWalkStatus(null);
      }
    },
    [setAutoWalkStatus],
  );

  const dispatchNextWalkStep = useCallback(() => {
    const queue = walkQueueRef.current;
    if (!queue || queue.steps.length === 0) {
      stopAutoWalk();
      return;
    }
    const nextStep = queue.steps[0];
    queue.inFlightExpectedNodeId = nextStep.expectedNodeId;
    setAutoWalkStatus({
      targetTitle: queue.targetTitle,
      remainingSteps: queue.steps.length,
    });
    runnerRef.current?.submitLine(nextStep.command);
  }, [setAutoWalkStatus, stopAutoWalk]);

  const handleWalkToNode = useCallback(
    (targetNodeId: string) => {
      const state = useGameStore.getState();
      if (!state.mapGraph?.currentNodeId || state.inputMode !== 'line') return;
      const plan = findShortestWalkPath(state.mapGraph, state.mapGraph.currentNodeId, targetNodeId);
      if (!plan || plan.steps.length === 0) {
        stopAutoWalk('No open route to that room.');
        return;
      }

      walkQueueRef.current = {
        targetTitle: plan.targetTitle,
        steps: [...plan.steps],
        inFlightExpectedNodeId: null,
      };
      dispatchNextWalkStep();
    },
    [dispatchNextWalkStep, stopAutoWalk],
  );

  useEffect(() => {
    fetchHealth()
      .then(setHealth)
      .catch(() => {});

    return () => {
      runnerRef.current?.dispose();
      sceneControllerRef.current?.reset();
      walkQueueRef.current = null;
    };
  }, []);

  // Resizable split-pane mouse handlers
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingSplitRef.current) return;
      const pct = (e.clientX / window.innerWidth) * 100;
      setSplitPercent(Math.min(72, Math.max(30, pct)));
    };
    const onUp = () => {
      draggingSplitRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const handleStartStory = useCallback(
    async (title: string, filename: string, bytes: Uint8Array) => {
      runnerRef.current?.dispose();
      sceneControllerRef.current?.reset();
      stopAutoWalk();

      const header = await fingerprintStory(bytes);
      const savedMap = await getSavedMap(header.storyId);
      const sessionId =
        typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      startSession(
        {
          sessionId,
          title,
          filename,
          header,
          bytes,
        },
        savedMap,
      );

      const runner = new BocfelRunner({
        onStatusLines: (lines) => setStatusLines(lines),
        onParagraphs: (paras, clear) => appendParagraphs(paras, clear),
        onInputChange: (mode, windowId) => {
          setInputState(mode, windowId);
          // Halt Click-to-Walk if game enters single-key char mode (e.g. menu/death prompt)
          if (mode === 'char' && walkQueueRef.current) {
            stopAutoWalk('Auto-walk paused for keypress prompt.');
          }
        },
        onTurnSettled: (turn) => {
          // 1. Update Phase 2 Auto-Map immediately on every turn (even during speed-walking)
          let nextCurrentNodeId: string | null = null;
          let nextIsDark = false;
          updateMapGraph((curr) => {
            const updated = applyTurnToMap(curr, turn);
            nextCurrentNodeId = updated.currentNodeId;
            nextIsDark = Boolean(
              updated.currentNodeId && updated.nodes[updated.currentNodeId]?.isDark,
            );
            void putSavedMap(updated);
            return updated;
          });

          // 2. Drive Phase 1 Scene Controller (debounced)
          sceneControllerRef.current?.handleTurn(turn);

          // 3. Advance Click-to-Walk safely if active
          const queue = walkQueueRef.current;
          if (queue && queue.inFlightExpectedNodeId !== null) {
            const arrived = nextCurrentNodeId === queue.inFlightExpectedNodeId;
            if (!arrived || nextIsDark) {
              stopAutoWalk(
                nextIsDark
                  ? 'Auto-walk halted: entered darkness.'
                  : 'Auto-walk halted: unexpected obstacle or event.',
              );
            } else {
              queue.steps.shift();
              queue.inFlightExpectedNodeId = null;
              if (queue.steps.length === 0) {
                stopAutoWalk();
              } else {
                setTimeout(() => dispatchNextWalkStep(), 140);
              }
            }
          }
        },
        onFilePrompt: async (prompt) => {
          stopAutoWalk();
          const mode: 'save' | 'restore' = prompt.filemode === 'read' ? 'restore' : 'save';
          return new Promise((resolve) => {
            setPendingFilePrompt({
              mode,
              resolve: (choice) => {
                if (!choice) {
                  resolve(null);
                  return;
                }
                // Restore synchronized RoomMemory & Auto-Map snapshot when loading a browser slot
                if (mode === 'restore') {
                  if (choice.roomMemory) {
                    sceneControllerRef.current?.observer.reset(choice.roomMemory);
                  }
                  if (choice.mapGraph) {
                    setMapGraph(choice.mapGraph);
                    void putSavedMap(choice.mapGraph);
                  }
                }
                const safeName = choice.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
                resolve({
                  path: `/saves/${safeName}`,
                  bytes: choice.bytes,
                });
              },
            });
          });
        },
        onFileWritten: (filePath, data) => {
          if (!filePath.startsWith('/saves/')) return;
          const activeStory = useGameStore.getState().story;
          if (!activeStory) return;
          const slotName = filePath.replace('/saves/', '').replace(/\.sav$/i, '');
          const roomTitle =
            useGameStore.getState().currentScene?.displayTitle ||
            useGameStore.getState().statusLines[0]?.trim() ||
            'Saved Position';

          void putSaveSlot({
            id: `${activeStory.header.storyId}:${slotName}`,
            storyId: activeStory.header.storyId,
            slotName,
            isAutosave: slotName === 'autosave',
            savedAt: Date.now(),
            roomTitle,
            stylePresetId: useGameStore.getState().stylePresetId,
            quetzalBytes: data,
            roomMemory: sceneControllerRef.current?.observer.exportRoomMemory() ?? [],
            mapGraph: useGameStore.getState().mapGraph ?? undefined,
          });
        },
        onError: (msg) => setVmError(msg),
      });

      runnerRef.current = runner;
      setLauncherOpen(false);
      await runner.start(filename, bytes);
    },
    [
      appendParagraphs,
      dispatchNextWalkStep,
      setInputState,
      setMapGraph,
      setPendingFilePrompt,
      setStatusLines,
      setVmError,
      startSession,
      stopAutoWalk,
      updateMapGraph,
    ],
  );

  const handleSubmitLine = useCallback(
    (cmd: string) => {
      if (walkQueueRef.current) stopAutoWalk();
      runnerRef.current?.submitLine(cmd);
    },
    [stopAutoWalk],
  );

  const handleSubmitChar = useCallback(
    (key: string) => {
      if (walkQueueRef.current) stopAutoWalk();
      runnerRef.current?.submitChar(key);
    },
    [stopAutoWalk],
  );

  const roomCount = mapGraph ? Object.keys(mapGraph.nodes).length : 0;
  const mapVisible = showVisualStage && (leftPaneMode === 'split' || leftPaneMode === 'map');

  const toggleAutoMap = () => {
    if (!showVisualStage || leftPaneMode === 'art') {
      setLeftPaneMode('split');
    } else {
      setLeftPaneMode('art');
    }
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      {/* Top Navigation Bar */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-800/90 bg-zinc-950 px-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-700 text-zinc-950">
            <Sparkles className="h-4 w-4" />
          </div>
          <span className="font-semibold tracking-tight text-zinc-100">Zorkaliser</span>
          {story && (
            <>
              <span className="text-zinc-700">/</span>
              <span className="truncate text-sm text-zinc-300">{story.title}</span>
              {story.header.zVersion && (
                <span className="hidden rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 sm:inline">
                  Z{story.header.zVersion}
                </span>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {story && (
            <>
              <button
                type="button"
                onClick={() => setReaderSettings({ showVisualStage: !showVisualStage })}
                className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
                title={showVisualStage ? 'Hide visual/map pane' : 'Show visual/map pane'}
              >
                {showVisualStage ? (
                  <PanelLeftClose className="h-3.5 w-3.5" />
                ) : (
                  <PanelLeftOpen className="h-3.5 w-3.5" />
                )}
                <span className="hidden md:inline">{showVisualStage ? 'Hide Pane' : 'Show Pane'}</span>
              </button>

              <button
                type="button"
                onClick={toggleAutoMap}
                className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition ${
                  mapVisible
                    ? 'border-amber-500/50 bg-amber-500/15 text-amber-300'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
                }`}
                title="Toggle Interactive Auto-Map"
              >
                <MapIcon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Auto-Map</span>
                {roomCount > 0 && (
                  <span className="rounded-full bg-zinc-800 px-1.5 py-0.2 text-[10px] tabular-nums text-zinc-300">
                    {roomCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setSavesOpen(true)}
                className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
              >
                <Save className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Saves</span>
              </button>

              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
              >
                <Settings className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Style & Reader</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => setLauncherOpen(true)}
            className="flex items-center gap-1.5 rounded-lg bg-amber-500/15 px-2.5 py-1.5 text-xs font-medium text-amber-300 transition hover:bg-amber-500/25"
          >
            <BookOpen className="h-3.5 w-3.5" />
            <span>{story ? 'Switch Game' : 'Load Game'}</span>
          </button>
        </div>
      </header>

      {/* Main Split-Pane Workspace */}
      <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {showVisualStage && (
          <section
            className="relative flex h-72 shrink-0 flex-col border-b border-zinc-800 lg:h-full lg:border-r lg:border-b-0"
            style={{
              flexBasis:
                typeof window !== 'undefined' && window.innerWidth >= 1024
                  ? `${splitPercent}%`
                  : undefined,
            }}
          >
            {/* Left-Pane Mode Switcher (Art | Art + Map | Map) */}
            {story && (
              <div className="flex shrink-0 items-center justify-between border-b border-zinc-800/80 bg-zinc-950 px-3 py-1.5">
                <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900 p-0.5 text-[11px]">
                  {(
                    [
                      { id: 'art', label: 'Art', icon: ImageIcon },
                      { id: 'split', label: 'Art + Map', icon: Columns2 },
                      { id: 'map', label: 'Map', icon: MapIcon },
                    ] as Array<{ id: LeftPaneMode; label: string; icon: React.ComponentType<{ className?: string }> }>
                  ).map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setLeftPaneMode(id)}
                      className={`flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition ${
                        leftPaneMode === id
                          ? 'bg-zinc-800 text-amber-300'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      <Icon className="h-3 w-3" />
                      {label}
                    </button>
                  ))}
                </div>
                <span className="hidden text-[11px] text-zinc-500 sm:inline">
                  {leftPaneMode === 'art'
                    ? 'Live Scene Artwork'
                    : leftPaneMode === 'split'
                      ? 'Artwork + Interactive Auto-Map'
                      : 'Full Interactive Auto-Map'}
                </span>
              </div>
            )}

            {/* Left Pane Body */}
            <div className="flex min-h-0 flex-1 flex-col">
              {(leftPaneMode === 'art' || leftPaneMode === 'split') && (
                <div
                  className={
                    leftPaneMode === 'split'
                      ? 'min-h-0 basis-[54%] border-b border-zinc-800'
                      : 'min-h-0 flex-1'
                  }
                >
                  <VisualStage
                    onRegenerate={() => void sceneControllerRef.current?.regenerateCurrentScene()}
                    onIllustrateNow={() => sceneControllerRef.current?.illustrateCurrentScene()}
                    onCancelJob={() => sceneControllerRef.current?.cancelActiveJob()}
                    onOpenSettings={() => setSettingsOpen(true)}
                  />
                </div>
              )}

              {(leftPaneMode === 'split' || leftPaneMode === 'map') && (
                <div className={leftPaneMode === 'split' ? 'min-h-0 basis-[46%]' : 'min-h-0 flex-1'}>
                  <MapCanvas
                    onWalkToNode={handleWalkToNode}
                    onStopWalk={() => stopAutoWalk()}
                  />
                </div>
              )}
            </div>
          </section>
        )}

        {/* Draggable Divider (Desktop) */}
        {showVisualStage && (
          <div
            onMouseDown={() => {
              draggingSplitRef.current = true;
              document.body.style.cursor = 'col-resize';
              document.body.style.userSelect = 'none';
            }}
            className="hidden w-1 cursor-col-resize bg-zinc-900 transition hover:bg-amber-500/70 lg:block"
            title="Drag to resize panes"
          />
        )}

        <section className="min-h-0 flex-1">
          <TerminalPane onSubmitLine={handleSubmitLine} onSubmitChar={handleSubmitChar} />
        </section>
      </main>

      {/* Modals */}
      <LauncherModal
        isOpen={launcherOpen}
        canClose={story !== null}
        health={health}
        onClose={() => setLauncherOpen(false)}
        onStartStory={handleStartStory}
      />

      <SaveLoadModal
        isOpen={savesOpen}
        onClose={() => setSavesOpen(false)}
        onTriggerSaveCommand={() => runnerRef.current?.submitLine('save')}
        onTriggerRestoreCommand={() => runnerRef.current?.submitLine('restore')}
      />

      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onApplyAndReillustrate={() => sceneControllerRef.current?.illustrateCurrentScene()}
      />
    </div>
  );
}

export default App;
