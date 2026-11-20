import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Map as MapIcon,
  PanelLeftClose,
  PanelLeftOpen,
  Save,
  Settings,
  Sparkles,
} from 'lucide-react';
import { LauncherModal } from './components/LauncherModal.js';
import { SaveLoadModal } from './components/SaveLoadModal.js';
import { SettingsModal } from './components/SettingsModal.js';
import { TerminalPane } from './components/TerminalPane.js';
import { VisualStage } from './components/VisualStage.js';
import { BocfelRunner } from './engine/bocfelRunner.js';
import { SceneController } from './engine/sceneController.js';
import { fingerprintStory } from './engine/storyFingerprint.js';
import { fetchHealth, type HealthResponse } from './services/apiClient.js';
import { putSaveSlot } from './services/storage.js';
import { useGameStore } from './store/gameStore.js';

export function App() {
  const {
    story,
    showVisualStage,
    startSession,
    setStatusLines,
    appendParagraphs,
    setInputState,
    setVmError,
    setReaderSettings,
    setPendingFilePrompt,
  } = useGameStore();

  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [launcherOpen, setLauncherOpen] = useState(true);
  const [savesOpen, setSavesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [splitPercent, setSplitPercent] = useState(54);

  const runnerRef = useRef<BocfelRunner | null>(null);
  const sceneControllerRef = useRef<SceneController | null>(null);
  const draggingSplitRef = useRef(false);

  if (!sceneControllerRef.current) {
    sceneControllerRef.current = new SceneController();
  }

  useEffect(() => {
    fetchHealth()
      .then(setHealth)
      .catch(() => {});

    return () => {
      runnerRef.current?.dispose();
      sceneControllerRef.current?.reset();
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

      const header = await fingerprintStory(bytes);
      const sessionId =
        typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      startSession({
        sessionId,
        title,
        filename,
        header,
        bytes,
      });

      const runner = new BocfelRunner({
        onStatusLines: (lines) => setStatusLines(lines),
        onParagraphs: (paras, clear) => appendParagraphs(paras, clear),
        onInputChange: (mode, windowId) => setInputState(mode, windowId),
        onTurnSettled: (turn) => {
          sceneControllerRef.current?.handleTurn(turn);
        },
        onFilePrompt: async (prompt) => {
          const mode: 'save' | 'restore' = prompt.filemode === 'read' ? 'restore' : 'save';
          return new Promise((resolve) => {
            setPendingFilePrompt({
              mode,
              resolve: (choice) => {
                if (!choice) {
                  resolve(null);
                  return;
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
          });
        },
        onError: (msg) => setVmError(msg),
      });

      runnerRef.current = runner;
      setLauncherOpen(false);
      await runner.start(filename, bytes);
    },
    [appendParagraphs, setInputState, setPendingFilePrompt, setStatusLines, setVmError, startSession],
  );

  const handleSubmitLine = useCallback((cmd: string) => {
    runnerRef.current?.submitLine(cmd);
  }, []);

  const handleSubmitChar = useCallback((key: string) => {
    runnerRef.current?.submitChar(key);
  }, []);

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
                title={showVisualStage ? 'Hide visual stage' : 'Show visual stage'}
              >
                {showVisualStage ? (
                  <PanelLeftClose className="h-3.5 w-3.5" />
                ) : (
                  <PanelLeftOpen className="h-3.5 w-3.5" />
                )}
                <span className="hidden md:inline">{showVisualStage ? 'Hide Art' : 'Show Art'}</span>
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
                disabled
                title="Interactive Auto-Mapping is scheduled for Phase 2"
                className="hidden items-center gap-1.5 rounded-lg border border-zinc-800/60 bg-zinc-900/40 px-2.5 py-1.5 text-xs text-zinc-500 lg:flex"
              >
                <MapIcon className="h-3.5 w-3.5" />
                <span>Auto-Map</span>
                <span className="rounded bg-zinc-800 px-1 text-[9px] uppercase">P2</span>
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
            className="h-56 shrink-0 border-b border-zinc-800 lg:h-full lg:border-r lg:border-b-0"
            style={{
              flexBasis: typeof window !== 'undefined' && window.innerWidth >= 1024 ? `${splitPercent}%` : undefined,
            }}
          >
            <VisualStage
              onRegenerate={() => void sceneControllerRef.current?.regenerateCurrentScene()}
              onIllustrateNow={() => sceneControllerRef.current?.illustrateCurrentScene()}
              onCancelJob={() => sceneControllerRef.current?.cancelActiveJob()}
              onOpenSettings={() => setSettingsOpen(true)}
            />
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
