export type GlkWindowType = 'buffer' | 'grid' | 'graphics';

export interface GlkWindowSpec {
  id: number;
  type: GlkWindowType;
  rock?: number;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  gridwidth?: number;
  gridheight?: number;
}

export interface GlkStyledSpan {
  style: string;
  text: string;
  hyperlink?: number;
}

export interface GlkBufferLine {
  append?: boolean;
  flowbreak?: boolean;
  content?: Array<string | GlkStyledSpan>;
}

export interface GlkGridLine {
  line: number;
  content?: Array<string | GlkStyledSpan>;
}

export interface GlkContentUpdate {
  id: number;
  clear?: boolean;
  text?: GlkBufferLine[];
  lines?: GlkGridLine[];
}

export interface GlkInputRequest {
  id: number;
  type: 'line' | 'char';
  gen?: number;
  maxlen?: number;
  initial?: string;
  terminators?: string[];
}

export interface GlkSpecialInput {
  type: 'fileref_prompt';
  filemode: 'read' | 'write' | 'readwrite' | 'writeappend';
  filetype: 'save' | 'transcript' | 'command' | 'data';
  gameid?: string;
}

export interface GlkUpdate {
  type: 'update' | 'error' | 'pass' | 'retry';
  gen?: number;
  windows?: GlkWindowSpec[];
  content?: GlkContentUpdate[];
  input?: GlkInputRequest[];
  specialinput?: GlkSpecialInput | null;
  disable?: boolean;
  message?: string;
}

export interface GlkEvent {
  type: 'init' | 'line' | 'char' | 'arrange' | 'specialresponse' | 'redraw' | 'timer' | 'hyperlink';
  gen?: number;
  window?: number;
  value?: unknown;
  response?: string;
  metrics?: {
    width: number;
    height: number;
    outspacingx?: number;
    outspacingy?: number;
    inspacingx?: number;
    inspacingy?: number;
    gridcharwidth?: number;
    gridcharheight?: number;
    gridmarginx?: number;
    gridmarginy?: number;
    buffercharwidth?: number;
    buffercharheight?: number;
    buffermarginx?: number;
    buffermarginy?: number;
  };
  support?: string[];
}

export interface RenderedSpan {
  style: string;
  text: string;
}

export interface RenderedParagraph {
  id: string;
  spans: RenderedSpan[];
  isCommandEcho?: boolean;
}

export interface TurnSnapshot {
  turnIndex: number;
  command: string;
  statusLines: string[];
  statusRoomTitle: string | null;
  narrativeDelta: string;
}
