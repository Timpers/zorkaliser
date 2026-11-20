import createBocfel from 'emglken/build/bocfel.js';
import bocfelWasmUrl from 'emglken/build/bocfel.wasm?url';
import type {
  GlkBufferLine,
  GlkEvent,
  GlkInputRequest,
  GlkSpecialInput,
  GlkStyledSpan,
  GlkUpdate,
  GlkWindowSpec,
  RenderedParagraph,
  RenderedSpan,
  TurnSnapshot,
} from './glkTypes.js';
import { parseStatusLineRoomTitle } from './turnObserver.js';

export interface BocfelCallbacks {
  onStatusLines: (lines: string[]) => void;
  onParagraphs: (paragraphs: RenderedParagraph[], clear: boolean) => void;
  onInputChange: (mode: 'line' | 'char' | 'disabled', windowId: number | null) => void;
  onTurnSettled: (turn: TurnSnapshot) => void;
  onFilePrompt: (
    prompt: GlkSpecialInput,
  ) => Promise<{ path: string; bytes?: Uint8Array } | null>;
  onFileWritten: (path: string, bytes: Uint8Array) => void;
  onError: (message: string) => void;
}

function normalizeSpans(content?: Array<string | GlkStyledSpan>): RenderedSpan[] {
  if (!content || content.length === 0) return [];
  const spans: RenderedSpan[] = [];
  for (let i = 0; i < content.length; i++) {
    const item = content[i];
    if (typeof item === 'string') {
      // GlkOte compact format: [style, text, style, text, ...]
      const next = content[i + 1];
      if (typeof next === 'string') {
        spans.push({ style: item, text: next });
        i++;
      } else {
        spans.push({ style: 'normal', text: item });
      }
    } else if (item && typeof item.text === 'string') {
      spans.push({ style: item.style || 'normal', text: item.text });
    }
  }
  return spans;
}

function spansToPlainText(spans: RenderedSpan[]): string {
  return spans.map((s) => s.text).join('');
}

/**
 * Wraps Emglken's Bocfel WebAssembly interpreter behind a clean TypeScript class
 * using a virtual async Dialog filesystem and React-friendly GlkOte bridge.
 */
export class BocfelRunner {
  private readonly callbacks: BocfelCallbacks;
  private readonly virtualFs = new Map<string, Uint8Array>();
  private readonly windows = new Map<number, GlkWindowSpec>();
  private readonly gridBuffers = new Map<number, string[]>();

  private acceptEvent: ((event: GlkEvent) => void) | null = null;
  private currentGen = 0;
  private activeInput: GlkInputRequest | null = null;
  private lastCommand = '';
  private turnIndex = 0;
  private pendingDeltaChunks: string[] = [];
  private disposed = false;
  private paraCounter = 0;

  constructor(callbacks: BocfelCallbacks) {
    this.callbacks = callbacks;
  }

  async start(filename: string, storyBytes: Uint8Array): Promise<void> {
    this.disposed = false;
    this.windows.clear();
    this.gridBuffers.clear();
    this.virtualFs.clear();
    this.currentGen = 0;
    this.turnIndex = 0;
    this.lastCommand = '';
    this.pendingDeltaChunks = [];

    const safeFile = filename.replace(/[^a-zA-Z0-9._-]/g, '_') || 'story.z5';
    const storyPath = `/story/${safeFile}`;
    this.virtualFs.set(storyPath, new Uint8Array(storyBytes));

    const dialog = {
      async: true as const,
      get_dirs: () => ({
        storyfile: '/story',
        system_cwd: '/story',
        temp: '/tmp',
        working: '/saves',
      }),
      set_storyfile_dir: (dir: string) => ({
        storyfile: dir,
        working: '/saves',
      }),
      exists: async (filePath: string) => this.virtualFs.has(filePath),
      read: async (filePath: string) => {
        const data = this.virtualFs.get(filePath);
        return data ? new Uint8Array(data) : null;
      },
      write: async (files: Record<string, Uint8Array>) => {
        for (const [filePath, data] of Object.entries(files)) {
          // Copy out of WASM HEAP8 view immediately before memory shifts
          const copy = new Uint8Array(data.byteLength);
          copy.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
          this.virtualFs.set(filePath, copy);
          this.callbacks.onFileWritten(filePath, copy);
        }
      },
      delete: async (filePath: string) => {
        this.virtualFs.delete(filePath);
      },
    };

    const glkote = {
      init: (options: { accept: (event: unknown) => void }) => {
        if (this.disposed) return;
        this.acceptEvent = options.accept as (event: GlkEvent) => void;
        this.acceptEvent({
          type: 'init',
          gen: 0,
          metrics: {
            width: 800,
            height: 600,
            outspacingx: 0,
            outspacingy: 0,
            inspacingx: 0,
            inspacingy: 0,
            gridcharwidth: 10,
            gridcharheight: 20,
            gridmarginx: 4,
            gridmarginy: 4,
            buffercharwidth: 10,
            buffercharheight: 20,
            buffermarginx: 8,
            buffermarginy: 8,
          },
          support: ['timer', 'hyperlinks'],
        });
      },
      update: (raw: unknown) => {
        if (this.disposed) return;
        this.handleUpdate(raw as GlkUpdate);
      },
    };

    try {
      const vm = await createBocfel({
        locateFile: (file) => (file.endsWith('.wasm') ? bocfelWasmUrl : file),
      });
      if (this.disposed) return;
      vm.start({
        arguments: [storyPath],
        Dialog: dialog,
        GlkOte: glkote,
      });
    } catch (err) {
      if (!this.disposed) {
        this.callbacks.onError(
          err instanceof Error ? err.message : 'Failed to initialize Bocfel Z-machine runtime',
        );
      }
    }
  }

  submitLine(command: string): void {
    if (this.disposed || !this.acceptEvent || !this.activeInput || this.activeInput.type !== 'line') {
      return;
    }
    const targetWindow = this.activeInput.id;
    this.lastCommand = command;
    this.activeInput = null;
    this.callbacks.onInputChange('disabled', null);

    // Echo command cleanly into transcript
    this.callbacks.onParagraphs(
      [
        {
          id: `cmd-${++this.paraCounter}`,
          spans: [{ style: 'input', text: `> ${command}` }],
          isCommandEcho: true,
        },
      ],
      false,
    );

    this.acceptEvent({
      type: 'line',
      gen: this.currentGen,
      window: targetWindow,
      value: command,
    });
  }

  submitChar(key: string): void {
    if (this.disposed || !this.acceptEvent || !this.activeInput || this.activeInput.type !== 'char') {
      return;
    }
    const targetWindow = this.activeInput.id;
    this.lastCommand = key;
    this.activeInput = null;
    this.callbacks.onInputChange('disabled', null);

    this.acceptEvent({
      type: 'char',
      gen: this.currentGen,
      window: targetWindow,
      value: key,
    });
  }

  putVirtualFile(filePath: string, bytes: Uint8Array): void {
    this.virtualFs.set(filePath, new Uint8Array(bytes));
  }

  dispose(): void {
    this.disposed = true;
    this.acceptEvent = null;
    this.activeInput = null;
  }

  private handleUpdate(update: GlkUpdate): void {
    if (update.type === 'error') {
      this.callbacks.onError(update.message || 'Z-machine runtime error');
      return;
    }
    if (update.type !== 'update') {
      return;
    }

    if (typeof update.gen === 'number') {
      this.currentGen = update.gen;
    }

    if (Array.isArray(update.windows)) {
      this.windows.clear();
      for (const win of update.windows) {
        this.windows.set(win.id, win);
      }
    }

    if (Array.isArray(update.content)) {
      for (const content of update.content) {
        const win = this.windows.get(content.id);
        if (!win) continue;

        if (win.type === 'grid') {
          this.applyGridContent(content.id, content.clear, content.lines);
        } else if (win.type === 'buffer') {
          this.applyBufferContent(content.clear, content.text);
        }
      }
    }

    // Handle Quetzal save/restore file prompt
    if (update.specialinput && update.specialinput.type === 'fileref_prompt') {
      this.activeInput = null;
      this.callbacks.onInputChange('disabled', null);
      void this.handleSpecialFilePrompt(update.specialinput);
      return;
    }

    if (update.disable) {
      this.activeInput = null;
      this.callbacks.onInputChange('disabled', null);
      return;
    }

    if (Array.isArray(update.input) && update.input.length > 0) {
      // Prefer buffer window input if multiple windows request input
      const preferred =
        update.input.find((inp) => this.windows.get(inp.id)?.type === 'buffer') ?? update.input[0];
      this.activeInput = preferred;
      this.callbacks.onInputChange(preferred.type, preferred.id);

      // Emit settled turn snapshot once narrative text has arrived
      const narrativeDelta = this.pendingDeltaChunks.join('\n').trim();
      this.pendingDeltaChunks = [];

      if (narrativeDelta.length > 0) {
        const statusLines = this.getAggregatedStatusLines();
        const snapshot: TurnSnapshot = {
          turnIndex: this.turnIndex,
          command: this.lastCommand,
          statusLines,
          statusRoomTitle: parseStatusLineRoomTitle(statusLines),
          narrativeDelta,
        };
        this.turnIndex++;
        this.callbacks.onTurnSettled(snapshot);
      }
    }
  }

  private async handleSpecialFilePrompt(prompt: GlkSpecialInput): Promise<void> {
    try {
      const choice = await this.callbacks.onFilePrompt(prompt);
      if (this.disposed || !this.acceptEvent) return;

      if (choice && choice.bytes) {
        this.virtualFs.set(choice.path, new Uint8Array(choice.bytes));
      }

      this.acceptEvent({
        type: 'specialresponse',
        gen: this.currentGen,
        response: 'fileref_prompt',
        value: choice ? choice.path : null,
      });
    } catch {
      if (!this.disposed && this.acceptEvent) {
        this.acceptEvent({
          type: 'specialresponse',
          gen: this.currentGen,
          response: 'fileref_prompt',
          value: null,
        });
      }
    }
  }

  private applyGridContent(
    winId: number,
    clear?: boolean,
    lines?: Array<{ line: number; content?: Array<string | GlkStyledSpan> }>,
  ): void {
    const existing = clear ? [] : [...(this.gridBuffers.get(winId) ?? [])];
    if (lines) {
      for (const entry of lines) {
        const text = spansToPlainText(normalizeSpans(entry.content));
        existing[entry.line] = text;
      }
    }
    this.gridBuffers.set(winId, existing);
    this.callbacks.onStatusLines(this.getAggregatedStatusLines());
  }

  private applyBufferContent(clear?: boolean, textLines?: GlkBufferLine[]): void {
    const out: RenderedParagraph[] = [];
    if (textLines) {
      for (const line of textLines) {
        const spans = normalizeSpans(line.content);
        const plain = spansToPlainText(spans);
        // Strip trailing bare prompt ">" lines because our input bar renders its own prompt
        if (plain.trim() === '>') continue;

        if (line.append && out.length > 0) {
          out[out.length - 1].spans.push(...spans);
        } else {
          out.push({
            id: `p-${++this.paraCounter}`,
            spans,
          });
        }
        if (plain.trim()) {
          this.pendingDeltaChunks.push(plain);
        }
      }
    }

    if (clear || out.length > 0) {
      this.callbacks.onParagraphs(out, Boolean(clear));
    }
  }

  private getAggregatedStatusLines(): string[] {
    const result: string[] = [];
    for (const [winId, win] of this.windows.entries()) {
      if (win.type === 'grid') {
        const lines = this.gridBuffers.get(winId) ?? [];
        for (const l of lines) {
          if (l && l.trim()) result.push(l);
        }
      }
    }
    return result;
  }
}
