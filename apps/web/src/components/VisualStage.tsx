import React, { useEffect, useState } from 'react';
import { getStylePreset } from '@zorkaliser/shared';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  Images,
  Info,
  Loader2,
  Maximize2,
  Palette,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react';
import { useGameStore } from '../store/gameStore.js';

interface VisualStageProps {
  onRegenerate: () => void;
  onIllustrateNow: () => void;
  onCancelJob: () => void;
  onOpenSettings: () => void;
}

export const VisualStage: React.FC<VisualStageProps> = ({
  onRegenerate,
  onIllustrateNow,
  onCancelJob,
  onOpenSettings,
}) => {
  const {
    currentScene,
    previousSceneUrl,
    variationsByCacheKey,
    activeVariationIndex,
    gallery,
    generationStage,
    generationMessage,
    visualError,
    stylePresetId,
    reactivityMode,
    selectVariation,
    selectGalleryScene,
    setVisualError,
  } = useGameStore();

  const [imageLoaded, setImageLoaded] = useState(true);
  const [showInspector, setShowInspector] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (currentScene?.imageUrl) {
      setImageLoaded(false);
    }
  }, [currentScene?.imageUrl]);

  const variations = currentScene ? variationsByCacheKey[currentScene.cacheKey] ?? [currentScene] : [];
  const stylePreset = getStylePreset(stylePresetId);
  const isBusy = generationStage !== 'idle';

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-zinc-950">
      {/* Main Canvas Area */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-gradient-to-b from-zinc-900 to-zinc-950">
        {/* Previous image behind for smooth 400ms crossfade */}
        {previousSceneUrl && (
          <img
            src={previousSceneUrl}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full object-cover opacity-100"
          />
        )}

        {/* Current artwork */}
        {currentScene ? (
          <img
            key={currentScene.imageUrl}
            src={currentScene.imageUrl}
            alt={currentScene.displayTitle}
            onLoad={() => setImageLoaded(true)}
            className={`relative z-10 h-full w-full object-cover transition-opacity duration-500 ${
              imageLoaded ? 'opacity-100' : 'opacity-0'
            }`}
          />
        ) : (
          <div className="flex max-w-sm flex-col items-center px-6 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900/80 text-amber-400">
              <ImageIcon className="h-8 w-8" />
            </div>
            <p className="mt-4 text-sm font-medium text-zinc-200">
              {isBusy ? generationMessage || 'Illustrating opening scene...' : 'Awaiting your first location'}
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              As you explore, Zorkaliser paints each room and major scene change in real time.
            </p>
            {reactivityMode === 'manual' && !isBusy && (
              <button
                type="button"
                onClick={onIllustrateNow}
                className="mt-4 flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-semibold text-zinc-950 hover:bg-amber-400"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Illustrate Current Scene
              </button>
            )}
          </div>
        )}

        {/* Subtle bottom vignette */}
        {currentScene && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-32 bg-gradient-to-t from-black/80 via-black/35 to-transparent" />
        )}

        {/* Top-left Live SSE Progress Pill (never blocks typing!) */}
        {isBusy && (
          <div className="absolute top-3 left-3 z-30 flex items-center gap-2 rounded-full border border-amber-500/40 bg-zinc-950/85 px-3 py-1.5 text-xs text-amber-200 shadow-lg backdrop-blur-md">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
            <span>{generationMessage || 'Illustrating scene...'}</span>
            <button
              type="button"
              onClick={onCancelJob}
              className="ml-1 rounded-full p-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              title="Cancel illustration"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {/* Non-blocking error toast */}
        {visualError && (
          <div className="absolute top-3 right-3 left-3 z-30 flex items-center justify-between gap-2 rounded-xl border border-red-500/40 bg-red-950/90 px-3.5 py-2 text-xs text-red-100 shadow-lg backdrop-blur-md">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-red-300" />
              <span>{visualError} — you can keep playing uninterrupted.</span>
            </div>
            <button
              type="button"
              onClick={() => setVisualError(null)}
              className="rounded p-1 hover:bg-red-900"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Bottom overlay bar */}
        <div className="absolute inset-x-0 bottom-0 z-30 flex flex-wrap items-end justify-between gap-2 p-3.5">
          <div className="min-w-0">
            {currentScene && (
              <>
                <div className="flex items-center gap-2">
                  <h2 className="truncate font-serif text-lg font-semibold text-white drop-shadow">
                    {currentScene.displayTitle}
                  </h2>
                  {currentScene.cacheHit && (
                    <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300 backdrop-blur-sm">
                      Cached
                    </span>
                  )}
                </div>
                {currentScene.stateTags.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {currentScene.stateTags.slice(0, 4).map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-black/55 px-2 py-0.5 text-[10px] text-zinc-300 backdrop-blur-sm"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Action Controls */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onOpenSettings}
              className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-black/60 px-2.5 py-1.5 text-xs text-zinc-200 backdrop-blur-md transition hover:bg-black/80"
              title="Switch art style"
            >
              <Palette className="h-3.5 w-3.5 text-amber-400" />
              <span className="hidden sm:inline">{stylePreset?.name ?? 'Custom Style'}</span>
            </button>

            {variations.length > 1 && (
              <div className="flex items-center rounded-lg border border-white/15 bg-black/60 text-xs text-zinc-200 backdrop-blur-md">
                <button
                  type="button"
                  disabled={activeVariationIndex <= 0}
                  onClick={() => selectVariation(activeVariationIndex - 1)}
                  className="p-1.5 hover:text-white disabled:opacity-35"
                  title="Previous variation"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <span className="px-1 text-[11px] tabular-nums">
                  {activeVariationIndex + 1}/{variations.length}
                </span>
                <button
                  type="button"
                  disabled={activeVariationIndex >= variations.length - 1}
                  onClick={() => selectVariation(activeVariationIndex + 1)}
                  className="p-1.5 hover:text-white disabled:opacity-35"
                  title="Next variation"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {currentScene ? (
              <button
                type="button"
                disabled={isBusy}
                onClick={onRegenerate}
                className="flex items-center gap-1 rounded-lg border border-white/15 bg-black/60 px-2.5 py-1.5 text-xs text-zinc-200 backdrop-blur-md transition hover:bg-black/80 disabled:opacity-40"
                title="Regenerate fresh variation"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isBusy ? 'animate-spin' : ''}`} />
                <span className="hidden md:inline">Regenerate</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={isBusy}
                onClick={onIllustrateNow}
                className="flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/20 px-2.5 py-1.5 text-xs text-amber-200 backdrop-blur-md transition hover:bg-amber-500/30 disabled:opacity-40"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Illustrate
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowGallery((v) => !v)}
              className={`rounded-lg border p-1.5 backdrop-blur-md transition ${
                showGallery
                  ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                  : 'border-white/15 bg-black/60 text-zinc-200 hover:bg-black/80'
              }`}
              title={`Scene gallery (${gallery.length})`}
            >
              <Images className="h-3.5 w-3.5" />
            </button>

            {currentScene && (
              <>
                <button
                  type="button"
                  onClick={() => setShowInspector((v) => !v)}
                  className={`rounded-lg border p-1.5 backdrop-blur-md transition ${
                    showInspector
                      ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                      : 'border-white/15 bg-black/60 text-zinc-200 hover:bg-black/80'
                  }`}
                  title="Inspect AI prompt & metadata"
                >
                  <Info className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setFullscreen(true)}
                  className="rounded-lg border border-white/15 bg-black/60 p-1.5 text-zinc-200 backdrop-blur-md transition hover:bg-black/80"
                  title="Fullscreen artwork"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Collapsible Prompt Inspector */}
      {showInspector && currentScene && (
        <div className="border-t border-zinc-800 bg-zinc-900/95 px-4 py-3 text-xs text-zinc-300">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-400">
            <span>
              Provider: <strong className="text-zinc-200">{currentScene.provider}</strong> ({currentScene.model})
            </span>
            <span>
              {currentScene.cacheHit
                ? 'Cache Hit (0 ms)'
                : `Generated in ${currentScene.latencyMs ?? 0} ms`}
            </span>
          </div>
          <p className="mt-1.5 leading-relaxed text-zinc-300">{currentScene.promptUsed}</p>
        </div>
      )}

      {/* Collapsible Session Gallery Strip */}
      {showGallery && (
        <div className="border-t border-zinc-800 bg-zinc-950 px-3 py-2.5">
          {gallery.length === 0 ? (
            <p className="text-center text-xs text-zinc-500">No scenes illustrated yet.</p>
          ) : (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {gallery.map((item) => {
                const active = item.imageUrl === currentScene?.imageUrl;
                return (
                  <button
                    key={item.imageUrl}
                    type="button"
                    onClick={() => selectGalleryScene(item)}
                    className={`group relative h-16 w-28 shrink-0 overflow-hidden rounded-lg border transition ${
                      active ? 'border-amber-400 ring-1 ring-amber-400' : 'border-zinc-800 opacity-75 hover:opacity-100'
                    }`}
                  >
                    <img
                      src={item.imageUrl}
                      alt={item.displayTitle}
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute inset-x-0 bottom-0 truncate bg-black/70 px-1.5 py-0.5 text-[10px] text-zinc-200">
                      {item.displayTitle}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Fullscreen Lightbox */}
      {fullscreen && currentScene && (
        <div
          onClick={() => setFullscreen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-6 backdrop-blur-sm"
        >
          <button
            type="button"
            onClick={() => setFullscreen(false)}
            className="absolute top-4 right-4 rounded-full bg-zinc-900 p-2 text-zinc-300 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={currentScene.imageUrl}
            alt={currentScene.displayTitle}
            className="max-h-full max-w-full rounded-xl object-contain shadow-2xl"
          />
        </div>
      )}
    </div>
  );
};
