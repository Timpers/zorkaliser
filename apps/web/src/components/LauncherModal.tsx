import React, { useRef, useState } from 'react';
import {
  CUSTOM_STYLE_ID,
  FREE_STORY_CATALOG,
  STYLE_PRESETS,
  type AspectRatio,
  type CatalogEntry,
  type ReactivityMode,
} from '@zorkaliser/shared';
import { BookOpen, Globe, Loader2, Palette, Sparkles, Upload, X } from 'lucide-react';
import { fetchStoryViaProxy, type HealthResponse } from '../services/apiClient.js';
import { useGameStore } from '../store/gameStore.js';

interface LauncherModalProps {
  isOpen: boolean;
  canClose: boolean;
  health: HealthResponse | null;
  onClose: () => void;
  onStartStory: (title: string, filename: string, bytes: Uint8Array) => Promise<void>;
}

export const LauncherModal: React.FC<LauncherModalProps> = ({
  isOpen,
  canClose,
  health,
  onClose,
  onStartStory,
}) => {
  const {
    stylePresetId,
    customStylePrompt,
    reactivityMode,
    aspectRatio,
    setStyleSettings,
  } = useGameStore();

  const [activeTab, setActiveTab] = useState<'catalog' | 'upload' | 'url'>('catalog');
  const [urlInput, setUrlInput] = useState('');
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  const handleFile = async (file: File) => {
    setError(null);
    setLoadingId('file');
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      if (bytes.length < 64) {
        throw new Error('File is too small to be a valid Z-machine story.');
      }
      const cleanTitle = file.name.replace(/\.(z[1-8]|zblorb|dat)$/i, '').replace(/[_-]+/g, ' ');
      await onStartStory(cleanTitle, file.name, bytes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed loading story file');
    } finally {
      setLoadingId(null);
    }
  };

  const handleCatalogLaunch = async (entry: CatalogEntry) => {
    setError(null);
    setLoadingId(entry.id);
    try {
      const { bytes, filename } = await fetchStoryViaProxy(entry.url);
      await onStartStory(entry.title, filename, bytes);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not fetch ${entry.title}`);
    } finally {
      setLoadingId(null);
    }
  };

  const handleUrlLaunch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim()) return;
    setError(null);
    setLoadingId('url');
    try {
      const { bytes, filename } = await fetchStoryViaProxy(urlInput.trim());
      const title = filename.replace(/\.(z[1-8]|zblorb|dat)$/i, '');
      await onStartStory(title, filename, bytes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not fetch story URL');
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
      <div className="relative flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800/80 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-700 text-zinc-950 shadow-lg shadow-amber-500/20">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-zinc-100">Zorkaliser</h1>
              <p className="text-xs text-zinc-400">
                Real-time AI-illustrated Z-machine interactive fiction player
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {health && (
              <span
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                  health.providers.image === 'mock'
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                    : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                }`}
              >
                AI: {health.providers.image === 'mock' ? 'Preview SVG Mode' : `${health.providers.llm} + ${health.providers.image}`}
              </span>
            )}
            {canClose && (
              <button
                onClick={onClose}
                className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                aria-label="Close launcher"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {/* Step 1: Visual Style */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
                <Palette className="h-4 w-4 text-amber-400" />
                1. Choose Visual Art Style
              </h2>
              <div className="flex items-center gap-2 text-xs">
                <label className="text-zinc-400">Reactivity:</label>
                <select
                  value={reactivityMode}
                  onChange={(e) =>
                    setStyleSettings({ reactivityMode: e.target.value as ReactivityMode })
                  }
                  className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 focus:border-amber-500 focus:outline-none"
                >
                  <option value="location_only">New Locations Only (Recommended)</option>
                  <option value="dynamic">Location + Major Scene Changes</option>
                  <option value="manual">Manual Illustrate Only</option>
                </select>
                <select
                  value={aspectRatio}
                  onChange={(e) => setStyleSettings({ aspectRatio: e.target.value as AspectRatio })}
                  className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 focus:border-amber-500 focus:outline-none"
                >
                  <option value="16:9">16:9</option>
                  <option value="4:3">4:3</option>
                  <option value="1:1">1:1</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {STYLE_PRESETS.map((preset) => {
                const selected = stylePresetId === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setStyleSettings({ stylePresetId: preset.id })}
                    className={`group relative overflow-hidden rounded-xl border p-3 text-left transition ${
                      selected
                        ? 'border-amber-400 ring-2 ring-amber-400/30'
                        : 'border-zinc-800 hover:border-zinc-700'
                    }`}
                    style={{
                      background: `linear-gradient(135deg, ${preset.gradient[0]} 0%, ${preset.gradient[1]} 100%)`,
                    }}
                  >
                    <div className="relative z-10">
                      <div className="text-xs font-semibold text-white">{preset.name}</div>
                      <div className="mt-1 line-clamp-2 text-[11px] leading-snug text-zinc-200/85">
                        {preset.tagline}
                      </div>
                    </div>
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => setStyleSettings({ stylePresetId: CUSTOM_STYLE_ID })}
                className={`rounded-xl border p-3 text-left transition ${
                  stylePresetId === CUSTOM_STYLE_ID
                    ? 'border-amber-400 bg-zinc-900 ring-2 ring-amber-400/30'
                    : 'border-dashed border-zinc-700 bg-zinc-900/50 hover:border-zinc-500'
                }`}
              >
                <div className="text-xs font-semibold text-zinc-100">Custom Style</div>
                <div className="mt-1 text-[11px] leading-snug text-zinc-400">
                  Describe any medium, era, or visual aesthetic
                </div>
              </button>
            </div>

            {stylePresetId === CUSTOM_STYLE_ID && (
              <input
                type="text"
                value={customStylePrompt}
                onChange={(e) => setStyleSettings({ customStylePrompt: e.target.value })}
                placeholder="e.g., Isometric claymation diorama with tilt-shift lighting and warm tungsten glow..."
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none"
              />
            )}
          </section>

          {/* Step 2: Select Story */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
                <BookOpen className="h-4 w-4 text-amber-400" />
                2. Load a Z-Machine Story (.z1–.z8 / .zblorb)
              </h2>
              <div className="flex rounded-lg border border-zinc-800 bg-zinc-900 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setActiveTab('catalog')}
                  className={`rounded-md px-3 py-1 font-medium transition ${
                    activeTab === 'catalog'
                      ? 'bg-zinc-800 text-zinc-100'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Free Classics
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('upload')}
                  className={`rounded-md px-3 py-1 font-medium transition ${
                    activeTab === 'upload'
                      ? 'bg-zinc-800 text-zinc-100'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Upload Local File
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('url')}
                  className={`rounded-md px-3 py-1 font-medium transition ${
                    activeTab === 'url'
                      ? 'bg-zinc-800 text-zinc-100'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  IF Archive URL
                </button>
              </div>
            </div>

            {error && (
              <div className="rounded-lg border border-red-500/40 bg-red-950/50 px-3.5 py-2.5 text-xs text-red-200">
                {error}
              </div>
            )}

            {activeTab === 'catalog' && (
              <div className="grid gap-2.5 sm:grid-cols-2">
                {FREE_STORY_CATALOG.map((entry) => {
                  const busy = loadingId === entry.id;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      disabled={loadingId !== null}
                      onClick={() => void handleCatalogLaunch(entry)}
                      className="flex flex-col justify-between rounded-xl border border-zinc-800 bg-zinc-900/70 p-3.5 text-left transition hover:border-amber-500/50 hover:bg-zinc-900 disabled:opacity-60"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-zinc-100">{entry.title}</span>
                          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
                            {entry.format}
                          </span>
                        </div>
                        <div className="mt-0.5 text-[11px] text-zinc-400">
                          {entry.author} ({entry.year}) · {entry.difficulty}
                        </div>
                        <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-zinc-300">
                          {entry.description}
                        </p>
                      </div>
                      <div className="mt-3 flex items-center justify-between text-xs font-medium text-amber-400">
                        <span>{busy ? 'Downloading from IF Archive...' : 'Launch Adventure →'}</span>
                        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {activeTab === 'upload' && (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) void handleFile(file);
                }}
                onClick={() => fileInputRef.current?.click()}
                className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 text-center transition ${
                  isDragging
                    ? 'border-amber-400 bg-amber-500/10'
                    : 'border-zinc-700 bg-zinc-900/40 hover:border-zinc-500'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".z1,.z2,.z3,.z4,.z5,.z6,.z7,.z8,.zblorb,.dat"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleFile(file);
                  }}
                />
                {loadingId === 'file' ? (
                  <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
                ) : (
                  <Upload className="h-8 w-8 text-zinc-400" />
                )}
                <p className="mt-3 text-sm font-medium text-zinc-200">
                  Drop your Infocom or Inform story file here, or click to browse
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  Supports .z1–.z8, .zblorb, and .dat — runs 100% locally in WebAssembly (story bytes never leave your browser)
                </p>
              </div>
            )}

            {activeTab === 'url' && (
              <form onSubmit={handleUrlLaunch} className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
                <label className="block text-xs text-zinc-400">
                  Paste an HTTPS URL from <code className="text-zinc-300">ifarchive.org</code>,{' '}
                  <code className="text-zinc-300">ifdb.org</code>, or{' '}
                  <code className="text-zinc-300">eblong.com</code>
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Globe className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-zinc-500" />
                    <input
                      type="url"
                      required
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      placeholder="https://ifarchive.org/if-archive/games/zcode/905.z5"
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-950 py-2 pr-3 pl-9 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loadingId !== null}
                    className="flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:opacity-50"
                  >
                    {loadingId === 'url' && <Loader2 className="h-4 w-4 animate-spin" />}
                    Load
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
