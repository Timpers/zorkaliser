import React from 'react';
import {
  CUSTOM_STYLE_ID,
  STYLE_PRESETS,
  type AspectRatio,
  type QualityTier,
  type ReactivityMode,
} from '@zorkaliser/shared';
import { Sparkles, X } from 'lucide-react';
import {
  useGameStore,
  type ReaderFont,
  type ReaderTheme,
} from '../store/gameStore.js';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyAndReillustrate: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  onApplyAndReillustrate,
}) => {
  const {
    stylePresetId,
    customStylePrompt,
    reactivityMode,
    aspectRatio,
    quality,
    readerTheme,
    readerFont,
    fontSizePx,
    setStyleSettings,
    setReaderSettings,
  } = useGameStore();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-zinc-100">Visual Style & Reader Settings</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-5">
          {/* Art Style */}
          <section className="space-y-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Art Style Preset
            </h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {STYLE_PRESETS.map((preset) => {
                const selected = stylePresetId === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setStyleSettings({ stylePresetId: preset.id })}
                    className={`rounded-xl border p-2.5 text-left transition ${
                      selected
                        ? 'border-amber-400 ring-2 ring-amber-400/30'
                        : 'border-zinc-800 opacity-85 hover:opacity-100'
                    }`}
                    style={{
                      background: `linear-gradient(135deg, ${preset.gradient[0]} 0%, ${preset.gradient[1]} 100%)`,
                    }}
                  >
                    <div className="text-xs font-semibold text-white">{preset.name}</div>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setStyleSettings({ stylePresetId: CUSTOM_STYLE_ID })}
                className={`rounded-xl border p-2.5 text-left transition ${
                  stylePresetId === CUSTOM_STYLE_ID
                    ? 'border-amber-400 bg-zinc-900 ring-2 ring-amber-400/30'
                    : 'border-dashed border-zinc-700 bg-zinc-900/50 hover:border-zinc-500'
                }`}
              >
                <div className="text-xs font-semibold text-zinc-100">Custom</div>
              </button>
            </div>

            {stylePresetId === CUSTOM_STYLE_ID && (
              <input
                type="text"
                value={customStylePrompt}
                onChange={(e) => setStyleSettings({ customStylePrompt: e.target.value })}
                placeholder="Describe your custom visual aesthetic..."
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
              />
            )}
          </section>

          {/* Generation Controls */}
          <section className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs text-zinc-400">Reactivity</label>
              <select
                value={reactivityMode}
                onChange={(e) =>
                  setStyleSettings({ reactivityMode: e.target.value as ReactivityMode })
                }
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-xs text-zinc-100"
              >
                <option value="location_only">Location Entry Only (Recommended)</option>
                <option value="dynamic">Location + Major Scene Changes</option>
                <option value="manual">Manual Only</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-400">Aspect Ratio</label>
              <select
                value={aspectRatio}
                onChange={(e) => setStyleSettings({ aspectRatio: e.target.value as AspectRatio })}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-xs text-zinc-100"
              >
                <option value="16:9">16:9 Widescreen</option>
                <option value="4:3">4:3 Classic</option>
                <option value="1:1">1:1 Square</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-400">Quality Tier</label>
              <select
                value={quality}
                onChange={(e) => setStyleSettings({ quality: e.target.value as QualityTier })}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-xs text-zinc-100"
              >
                <option value="fast">Fast (Real-Time)</option>
                <option value="balanced">Balanced</option>
                <option value="high">High Detail</option>
              </select>
            </div>
          </section>

          {/* Reader Typography */}
          <section className="space-y-3 border-t border-zinc-800 pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Terminal & Typography
            </h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs text-zinc-400">Theme</label>
                <select
                  value={readerTheme}
                  onChange={(e) =>
                    setReaderSettings({ readerTheme: e.target.value as ReaderTheme })
                  }
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-xs text-zinc-100"
                >
                  <option value="midnight">Midnight Dark</option>
                  <option value="parchment">Parchment Light</option>
                  <option value="sepia">Warm Sepia</option>
                  <option value="crt">Retro Green CRT</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-400">Font Family</label>
                <select
                  value={readerFont}
                  onChange={(e) =>
                    setReaderSettings({ readerFont: e.target.value as ReaderFont })
                  }
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-xs text-zinc-100"
                >
                  <option value="serif">Book Serif</option>
                  <option value="sans">Clean Sans</option>
                  <option value="mono">Terminal Monospace</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-400">
                  Font Size ({fontSizePx}px)
                </label>
                <input
                  type="range"
                  min={14}
                  max={22}
                  value={fontSizePx}
                  onChange={(e) => setReaderSettings({ fontSizePx: Number(e.target.value) })}
                  className="mt-2 w-full accent-amber-500"
                />
              </div>
            </div>
          </section>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-700 px-3.5 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-900"
          >
            Done
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onApplyAndReillustrate();
            }}
            className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-semibold text-zinc-950 hover:bg-amber-400"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Re-illustrate Current Room
          </button>
        </div>
      </div>
    </div>
  );
};
