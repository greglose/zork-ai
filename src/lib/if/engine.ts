// Z-machine engine over ifvms ZVM with an in-memory GlkOte and Dialog. Browser-safe: it imports only
// glkote-term's pure Glk API (src/glkapi.js), never the package index (which pulls fs/readline/os).
// No DOM, no timers, no Date/Math.random. The caller supplies the story bytes.
// @ts-ignore -- ifvms ships no type declarations
import { ZVM } from 'ifvms';
// @ts-ignore -- glkote-term ships no type declarations
import Glk from 'glkote-term/src/glkapi.js';
import type { Turn } from './types';

export type Engine = {
  start(): Promise<Turn>;
  send(command: string): Promise<Turn>;
  save(): Uint8Array;
  restore(data: Uint8Array): Promise<Turn>;
};

type Styled = string | { text?: string };
type GlkUpdate = {
  gen: number;
  windows?: { id: number; type: string }[];
  content?: {
    id: number;
    clear?: boolean;
    text?: { append?: boolean; content?: Styled[] }[];
    lines?: { line: number; content?: Styled[] }[];
  }[];
  input?: { id: number; type: string }[];
  specialinput?: { type: string };
  exit?: boolean;
};

// Every metrics field is required: a missing margin yields NaN and ifvms v3_status throws.
const METRICS = {
  width: 80,
  height: 24,
  charwidth: 1,
  charheight: 1,
  buffercharwidth: 1,
  buffercharheight: 1,
  gridcharwidth: 1,
  gridcharheight: 1,
  buffermarginx: 0,
  buffermarginy: 0,
  gridmarginx: 0,
  gridmarginy: 0,
  graphicsmarginx: 0,
  graphicsmarginy: 0,
  spacingx: 0,
  spacingy: 0,
  inspacingx: 0,
  inspacingy: 0,
  outspacingx: 0,
  outspacingy: 0,
};

// Styled content is a flat [style, text, style, text...] list, or objects carrying `text`.
function flatten(items: Styled[] | undefined): string {
  let out = '';
  for (let i = 0; i < (items?.length ?? 0); i++) {
    const item = items![i];
    if (typeof item === 'string') {
      // Strings alternate style name / text; take the text half.
      if (i % 2 === 1) out += item;
    } else if (item && typeof item.text === 'string') {
      out += item.text;
      // Mixed lists use objects only, so keep parity for string items that follow.
    }
  }
  return out;
}

function parseStatus(line: string): Turn['status'] {
  const m = /^(.*?)\s{2,}Score:\s*(-?\d+)\s+(?:Turns|Moves):\s*(\d+)/.exec(line.trim());
  if (!m) return null;
  return { location: m[1].trim(), score: Number(m[2]), moves: Number(m[3]) };
}

// `glk` is injectable because glkote-term's Glk is a module singleton: tests (or a page that restarts
// the game without reloading) pass a pristine copy. Production uses the default.
export function createEngine(story: Uint8Array, glk: unknown = Glk): Engine {
  const files = new Map<string, Uint8Array>();
  const windowTypes = new Map<number, string>();
  let tempCounter = 0;
  let iface: { accept(ev: unknown): void } | null = null;
  let gen = 0;
  let lineWindow: number | null = null;
  let finished = false;
  let statusLine = '';
  let buffer: string[] = [];
  let lastSaved: Uint8Array | null = null;
  let savedKey = '';
  let restoreData: Uint8Array | null = null;
  let waiter: (() => void) | null = null;
  let promptPending = false;

  // Answers the game's save/restore file prompt with the in-memory slot.
  function answerPrompt(): void {
    while (promptPending) {
      promptPending = false;
      const name = restoreData ? 'restore-slot' : 'save-slot';
      savedKey = name;
      if (restoreData) files.set(name, restoreData);
      iface!.accept({
        type: 'specialresponse',
        gen,
        response: 'fileref_prompt',
        value: { filename: name, usage: 'save', gameid: '' },
      });
    }
  }

  const Dialog = {
    streaming: false,
    file_construct_ref: (filename: string, usage: string, gameid: string) => ({ filename, usage, gameid }),
    file_construct_temp_ref: (usage: string) => ({ filename: `temp${tempCounter++}`, usage, gameid: '' }),
    file_clean_fixed_name: (name: string) => name,
    file_ref_exists: (ref: { filename: string }) => files.has(ref.filename),
    file_remove_ref: (ref: { filename: string }) => void files.delete(ref.filename),
    file_read: (ref: { filename: string }) => files.get(ref.filename) ?? null,
    file_write: (ref: { filename: string }, content: ArrayLike<number> | string) => {
      const bytes = typeof content === 'string' ? new Uint8Array(0) : Uint8Array.from(content);
      files.set(ref.filename, bytes);
      if (ref.filename === savedKey) lastSaved = bytes;
      return true;
    },
    autosave_read: () => null,
    autosave_write: () => undefined,
  };

  const GlkOte = {
    init(i: { accept(ev: unknown): void }) {
      iface = i;
      i.accept({ type: 'init', gen: 0, metrics: METRICS, support: [] });
    },
    update(data: GlkUpdate) {
      gen = data.gen;
      for (const w of data.windows ?? []) windowTypes.set(w.id, w.type);
      for (const c of data.content ?? []) {
        const type = windowTypes.get(c.id);
        if (type === 'grid') {
          for (const l of c.lines ?? []) if (l.line === 0) statusLine = flatten(l.content);
        } else if (type === 'buffer') {
          if (c.clear) buffer = [];
          for (const t of c.text ?? []) {
            const text = flatten(t.content);
            if (t.append && buffer.length) buffer[buffer.length - 1] += text;
            else buffer.push(text);
          }
        }
      }
      if (data.exit) finished = true;
      if (data.specialinput?.type === 'fileref_prompt') {
        // Answer after the outer accept() returns: resuming the VM re-entrantly from inside
        // update() stalls it.
        promptPending = true;
        return;
      }
      const line = (data.input ?? []).find((x) => x.type === 'line');
      lineWindow = line ? line.id : null;
      const char = (data.input ?? []).find((x) => x.type === 'char');
      if (!line && char && !data.exit) {
        // "Press any key" prompts: answer so the game can proceed.
        iface!.accept({ type: 'char', gen, window: char.id, value: 'return' });
        return;
      }
      waiter?.();
    },
    error: () => undefined,
    log: () => undefined,
    warning: () => undefined,
    // glkapi only calls this for autosave, which is off.
    save_allstate: () => ({}),
  };

  const vm = new ZVM();
  let started = false;

  function turn(): Turn {
    const text = buffer.join('\n');
    buffer = [];
    return { text, status: parseStatus(statusLine), finished };
  }

  function sendLine(command: string): void {
    if (lineWindow === null || finished) return;
    const win = lineWindow;
    lineWindow = null;
    iface!.accept({ type: 'line', gen, window: win, value: command });
  }

  // Updates arrive synchronously inside accept()/init(); the promise form keeps send() async-safe
  // if a future Glk build defers them.
  function run(action: () => void): Promise<void> {
    return new Promise((resolve) => {
      waiter = () => {
        waiter = null;
        resolve();
      };
      action();
      answerPrompt();
      if (waiter === null) return;
      if (lineWindow !== null || finished) waiter();
    });
  }

  return {
    async start() {
      if (!started) {
        started = true;
        vm.prepare(story, { vm, Dialog, Glk: glk, GlkOte });
        await run(() => (glk as typeof Glk).init({ vm, Dialog, Glk: glk, GlkOte }));
      }
      return turn();
    },
    async send(command) {
      if (command.trim() === '') {
        return { text: '', status: parseStatus(statusLine), finished };
      }
      await run(() => sendLine(command));
      return turn();
    },
    save() {
      // Drive the game's own SAVE command so the saved state includes a correct resume point.
      lastSaved = null;
      restoreData = null;
      // Glk updates are synchronous, so the prompt and the file write complete inside these calls.
      sendLine('save');
      answerPrompt();
      buffer = [];
      if (!lastSaved) throw new Error('Z-machine save produced no data');
      return lastSaved;
    },
    async restore(data) {
      restoreData = data;
      await run(() => sendLine('restore'));
      restoreData = null;
      buffer = [];
      // The restored game redraws its status line on the next input request.
      return turn();
    },
  };
}
