import React, { useEffect, useRef, useState } from 'react';
import { Compass, CornerDownLeft } from 'lucide-react';
import { useGameStore, type ReaderFont, type ReaderTheme } from '../store/gameStore.js';

interface TerminalPaneProps {
  onSubmitLine: (cmd: string) => void;
  onSubmitChar: (key: string) => void;
}

const THEME_CLASSES: Record<
  ReaderTheme,
  { bg: string; text: string; statusBg: string; statusText: string; inputBg: string; cmd: string }
> = {
  midnight: {
    bg: 'bg-zinc-950',
    text: 'text-zinc-200',
    statusBg: 'bg-zinc-900/95 border-zinc-800',
    statusText: 'text-amber-300',
    inputBg: 'bg-zinc-900/80 border-zinc-800',
    cmd: 'text-amber-400',
  },
  parchment: {
    bg: 'bg-[#f6f1e5]',
    text: 'text-[#29231b]',
    statusBg: 'bg-[#e7decb] border-[#d4c7ac]',
    statusText: 'text-[#4a3922]',
    inputBg: 'bg-[#efe8d8] border-[#d4c7ac]',
    cmd: 'text-[#8c4a12]',
  },
  sepia: {
    bg: 'bg-[#1f1a15]',
    text: 'text-[#e5d8c5]',
    statusBg: 'bg-[#2a221b] border-[#3d3126]',
    statusText: 'text-[#e5b869]',
    inputBg: 'bg-[#272019] border-[#3d3126]',
    cmd: 'text-[#e5b869]',
  },
  crt: {
    bg: 'bg-[#040c06]',
    text: 'text-[#4ade80]',
    statusBg: 'bg-[#07190c] border-[#14532d]',
    statusText: 'text-[#86efac]',
    inputBg: 'bg-[#061409] border-[#14532d]',
    cmd: 'text-[#bbf7d0]',
  },
};

const FONT_CLASSES: Record<ReaderFont, string> = {
  serif: 'font-serif',
  sans: 'font-sans',
  mono: 'font-mono',
};

function spanClass(style: string): string {
  switch (style) {
    case 'emphasized':
      return 'italic';
    case 'subheader':
      return 'font-bold tracking-tight';
    case 'header':
      return 'text-lg font-bold tracking-tight';
    case 'preformatted':
      return 'font-mono whitespace-pre';
    case 'alert':
      return 'font-semibold underline decoration-amber-500/60';
    case 'note':
      return 'opacity-80 italic';
    default:
      return '';
  }
}

const QUICK_DIRECTIONS = ['N', 'S', 'E', 'W', 'U', 'D', 'Look', 'Inv'];

export const TerminalPane: React.FC<TerminalPaneProps> = ({ onSubmitLine, onSubmitChar }) => {
  const {
    statusLines,
    paragraphs,
    inputMode,
    commandHistory,
    vmError,
    readerTheme,
    readerFont,
    fontSizePx,
    pushCommandHistory,
  } = useGameStore();

  const [input, setInput] = useState('');
  const [historyIdx, setHistoryIdx] = useState<number>(-1);
  const [showCompass, setShowCompass] = useState(false);
  const scrollEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const theme = THEME_CLASSES[readerTheme];
  const fontClass = FONT_CLASSES[readerFont];

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [paragraphs.length]);

  useEffect(() => {
    if (inputMode === 'line') {
      inputRef.current?.focus();
    }
  }, [inputMode, paragraphs.length]);

  // Capture single-keypress Glk char input (e.g. "Press any key to continue")
  useEffect(() => {
    if (inputMode !== 'char') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (
        document.activeElement &&
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)
      ) {
        return;
      }
      e.preventDefault();
      const map: Record<string, string> = {
        Enter: 'return',
        Escape: 'escape',
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
        ' ': ' ',
      };
      onSubmitChar(map[e.key] ?? (e.key.length === 1 ? e.key : 'return'));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [inputMode, onSubmitChar]);

  const sendCommand = (raw: string) => {
    if (inputMode !== 'line') return;
    pushCommandHistory(raw);
    onSubmitLine(raw);
    setInput('');
    setHistoryIdx(-1);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendCommand(input);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length === 0) return;
      const next =
        historyIdx === -1 ? commandHistory.length - 1 : Math.max(0, historyIdx - 1);
      setHistoryIdx(next);
      setInput(commandHistory[next] ?? '');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIdx === -1) return;
      const next = historyIdx + 1;
      if (next >= commandHistory.length) {
        setHistoryIdx(-1);
        setInput('');
      } else {
        setHistoryIdx(next);
        setInput(commandHistory[next] ?? '');
      }
    }
  };

  return (
    <div className={`flex h-full w-full flex-col ${theme.bg} ${theme.text}`}>
      {/* Pinned Glk Grid Status Bar */}
      {statusLines.length > 0 && (
        <div
          className={`shrink-0 border-b px-4 py-2 font-mono text-xs tracking-wide ${theme.statusBg} ${theme.statusText}`}
        >
          {statusLines.map((line, idx) => (
            <div key={idx} className="truncate whitespace-pre">
              {line}
            </div>
          ))}
        </div>
      )}

      {/* Main Scrolling Story Buffer */}
      <div
        className={`flex-1 overflow-y-auto px-5 py-5 sm:px-7 ${fontClass}`}
        style={{ fontSize: `${fontSizePx}px`, lineHeight: 1.65 }}
        onClick={() => inputRef.current?.focus()}
      >
        <div className="mx-auto max-w-2xl space-y-2.5">
          {vmError && (
            <div className="rounded-lg border border-red-500/40 bg-red-950/60 p-3 font-sans text-xs text-red-200">
              Runtime error: {vmError}
            </div>
          )}

          {paragraphs.map((p) => (
            <p
              key={p.id}
              className={
                p.isCommandEcho
                  ? `pt-2 font-mono text-sm font-medium ${theme.cmd}`
                  : 'whitespace-pre-wrap break-words'
              }
            >
              {p.spans.length === 0 ? (
                <span>&nbsp;</span>
              ) : (
                p.spans.map((span, idx) => (
                  <span key={idx} className={spanClass(span.style)}>
                    {span.text}
                  </span>
                ))
              )}
            </p>
          ))}
          <div ref={scrollEndRef} className="h-4" />
        </div>
      </div>

      {/* Collapsible Quick Compass Bar */}
      {showCompass && inputMode === 'line' && (
        <div className={`flex flex-wrap gap-1.5 border-t px-4 py-2 ${theme.inputBg}`}>
          {QUICK_DIRECTIONS.map((dir) => (
            <button
              key={dir}
              type="button"
              onClick={() => sendCommand(dir.toLowerCase())}
              className="rounded-md border border-zinc-700/60 bg-black/20 px-2.5 py-1 font-mono text-xs transition hover:border-amber-500/60 hover:text-amber-300"
            >
              {dir}
            </button>
          ))}
        </div>
      )}

      {/* Command Input Bar */}
      <div className={`shrink-0 border-t px-4 py-3 ${theme.inputBg}`}>
        {inputMode === 'char' ? (
          <button
            type="button"
            onClick={() => onSubmitChar(' ')}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/15 py-2.5 text-sm font-medium text-amber-300 transition hover:bg-amber-500/25"
          >
            Press any key (or click here) to continue...
          </button>
        ) : (
          <form onSubmit={handleSubmit} className="mx-auto flex max-w-2xl items-center gap-2">
            <span className={`font-mono text-base font-bold ${theme.cmd}`}>&gt;</span>
            <input
              ref={inputRef}
              type="text"
              value={input}
              disabled={inputMode !== 'line'}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                inputMode === 'line'
                  ? 'Type a command (e.g. look, open mailbox, north)...'
                  : 'Waiting for interpreter...'
              }
              autoComplete="off"
              spellCheck={false}
              className="flex-1 bg-transparent font-mono text-sm focus:outline-none disabled:opacity-40"
            />
            <button
              type="button"
              onClick={() => setShowCompass((v) => !v)}
              className={`rounded-md p-1.5 transition ${
                showCompass ? 'text-amber-400' : 'opacity-60 hover:opacity-100'
              }`}
              title="Toggle quick compass"
            >
              <Compass className="h-4 w-4" />
            </button>
            <button
              type="submit"
              disabled={inputMode !== 'line'}
              className="rounded-lg bg-amber-500/20 px-2.5 py-1.5 text-amber-400 transition hover:bg-amber-500/30 disabled:opacity-30"
              aria-label="Send command"
            >
              <CornerDownLeft className="h-4 w-4" />
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
