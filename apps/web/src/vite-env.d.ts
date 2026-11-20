/// <reference types="vite/client" />

declare module 'emglken/build/bocfel.js' {
  export interface BocfelStartOptions {
    arguments: string[];
    Dialog: {
      async: true;
      get_dirs: () => {
        storyfile: string;
        system_cwd: string;
        temp: string;
        working: string;
      };
      set_storyfile_dir: (path: string) => {
        storyfile: string;
        working: string;
      };
      exists: (path: string) => Promise<boolean>;
      read: (path: string) => Promise<Uint8Array | null>;
      write: (files: Record<string, Uint8Array>) => Promise<void>;
      delete: (path: string) => Promise<void>;
    };
    GlkOte: {
      init: (options: BocfelStartOptions & { accept: (event: unknown) => void }) => void;
      update: (data: unknown) => void;
    };
    accept?: (event: unknown) => void;
  }

  export interface BocfelModule {
    start: (options: BocfelStartOptions) => void;
  }

  export default function createBocfel(moduleArg?: {
    locateFile?: (filename: string, prefix?: string) => string;
    print?: (text: string) => void;
    printErr?: (text: string) => void;
  }): Promise<BocfelModule>;
}

declare module 'emglken/build/bocfel.wasm?url' {
  const src: string;
  export default src;
}
