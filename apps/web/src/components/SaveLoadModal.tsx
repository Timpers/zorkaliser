import React, { useEffect, useRef, useState } from 'react';
import { Download, FolderOpen, Save, Trash2, Upload, X } from 'lucide-react';
import { deleteSaveSlot, listSaveSlots, type SavedSlotRecord } from '../services/storage.js';
import { useGameStore } from '../store/gameStore.js';

interface SaveLoadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTriggerSaveCommand: () => void;
  onTriggerRestoreCommand: () => void;
}

export const SaveLoadModal: React.FC<SaveLoadModalProps> = ({
  isOpen,
  onClose,
  onTriggerSaveCommand,
  onTriggerRestoreCommand,
}) => {
  const { story, pendingFilePrompt, setPendingFilePrompt } = useGameStore();
  const [slots, setSlots] = useState<SavedSlotRecord[]>([]);
  const [slotName, setSlotName] = useState('slot-1');
  const uploadRef = useRef<HTMLInputElement | null>(null);

  const visible = isOpen || pendingFilePrompt !== null;

  const refreshSlots = async () => {
    if (!story) return;
    const list = await listSaveSlots(story.header.storyId);
    setSlots(list);
  };

  useEffect(() => {
    if (visible && story) {
      void refreshSlots();
    }
  }, [visible, story?.header.storyId]);

  if (!visible || !story) return null;

  const handleClose = () => {
    if (pendingFilePrompt) {
      pendingFilePrompt.resolve(null);
      setPendingFilePrompt(null);
    }
    onClose();
  };

  const handleConfirmSave = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = slotName.trim().replace(/[^a-zA-Z0-9._-]/g, '_') || 'save';
    if (pendingFilePrompt && pendingFilePrompt.mode === 'save') {
      pendingFilePrompt.resolve({ filename: `${cleaned}.sav` });
      setPendingFilePrompt(null);
      onClose();
    }
  };

  const handleRestoreSlot = (slot: SavedSlotRecord) => {
    if (pendingFilePrompt && pendingFilePrompt.mode === 'restore') {
      pendingFilePrompt.resolve({
        filename: `${slot.slotName}.sav`,
        bytes: slot.quetzalBytes,
      });
      setPendingFilePrompt(null);
      onClose();
    }
  };

  const handleUploadSav = async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (pendingFilePrompt && pendingFilePrompt.mode === 'restore') {
      pendingFilePrompt.resolve({ filename: file.name, bytes });
      setPendingFilePrompt(null);
      onClose();
    }
  };

  const handleDownloadSav = (slot: SavedSlotRecord) => {
    const copy = new Uint8Array(slot.quetzalBytes.byteLength);
    copy.set(slot.quetzalBytes);
    const blob = new Blob([copy.buffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${story.title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${slot.slotName}.sav`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDelete = async (id: string) => {
    await deleteSaveSlot(id);
    await refreshSlots();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3.5">
          <div className="flex items-center gap-2">
            {pendingFilePrompt?.mode === 'restore' ? (
              <FolderOpen className="h-4 w-4 text-amber-400" />
            ) : (
              <Save className="h-4 w-4 text-amber-400" />
            )}
            <h2 className="text-sm font-semibold text-zinc-100">
              {pendingFilePrompt?.mode === 'save'
                ? 'Save Quetzal Game State'
                : pendingFilePrompt?.mode === 'restore'
                  ? 'Restore Quetzal Game State'
                  : 'Saved Games (Quetzal .sav)'}
            </h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {/* Quick trigger when opened from header bar rather than VM prompt */}
          {!pendingFilePrompt && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onTriggerSaveCommand();
                }}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-zinc-950 hover:bg-amber-400"
              >
                <Save className="h-3.5 w-3.5" />
                Save Current Progress
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onTriggerRestoreCommand();
                }}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-800"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                Restore From Slot / File
              </button>
            </div>
          )}

          {/* Save slot name form when VM requested a save */}
          {pendingFilePrompt?.mode === 'save' && (
            <form onSubmit={handleConfirmSave} className="space-y-2.5">
              <label className="block text-xs text-zinc-400">Save slot name</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={slotName}
                  onChange={(e) => setSlotName(e.target.value)}
                  placeholder="slot-1"
                  autoFocus
                  className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none"
                />
                <button
                  type="submit"
                  className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-zinc-950 hover:bg-amber-400"
                >
                  Save
                </button>
              </div>
            </form>
          )}

          {/* Upload external .sav when restoring */}
          {pendingFilePrompt?.mode === 'restore' && (
            <div>
              <input
                ref={uploadRef}
                type="file"
                accept=".sav,.qzl,.quetzal"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleUploadSav(file);
                }}
              />
              <button
                type="button"
                onClick={() => uploadRef.current?.click()}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-700 bg-zinc-900/50 py-2.5 text-xs font-medium text-zinc-300 hover:border-amber-500/60 hover:text-amber-300"
              >
                <Upload className="h-3.5 w-3.5" />
                Upload Portable Quetzal (.sav) File From Disk
              </button>
            </div>
          )}

          {/* Browser IndexedDB Save Slots */}
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-zinc-400">
              Browser Save Slots for {story.title}
            </h3>
            {slots.length === 0 ? (
              <p className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-4 text-center text-xs text-zinc-500">
                No saved games in browser storage yet. Type <code className="text-zinc-300">save</code>{' '}
                or click Save Current Progress.
              </p>
            ) : (
              <div className="max-h-60 space-y-2 overflow-y-auto">
                {slots.map((slot) => (
                  <div
                    key={slot.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-zinc-100">
                        {slot.slotName}
                      </div>
                      <div className="truncate text-[11px] text-zinc-400">
                        {slot.roomTitle || 'Saved State'} ·{' '}
                        {new Date(slot.savedAt).toLocaleString()}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      {pendingFilePrompt?.mode === 'restore' && (
                        <button
                          type="button"
                          onClick={() => handleRestoreSlot(slot)}
                          className="rounded-md bg-amber-500 px-2.5 py-1 text-xs font-semibold text-zinc-950 hover:bg-amber-400"
                        >
                          Load
                        </button>
                      )}
                      {pendingFilePrompt?.mode === 'save' && (
                        <button
                          type="button"
                          onClick={() => setSlotName(slot.slotName)}
                          className="rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
                        >
                          Overwrite
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDownloadSav(slot)}
                        className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                        title="Download Quetzal .sav"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(slot.id)}
                        className="rounded p-1.5 text-zinc-400 hover:bg-red-950 hover:text-red-300"
                        title="Delete slot"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
