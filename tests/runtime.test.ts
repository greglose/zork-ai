// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { read } from './helpers';
import { defaultSettings } from '../src/lib/if/settings';
import { GAME_SAVE_KEY, SETTINGS_KEY, writeSettings } from '../src/lib/if/save';
import type { Turn } from '../src/lib/if/types';

// The story engine and the OpenRouter client are stubbed; the page, the controller, the settings panel and the
// UI are the real built page and real code. The media store is an in-memory map (no IndexedDB in happy-dom).
const fake = vi.hoisted(() => ({
  sent: [] as string[],
  images: [] as string[],
  videos: [] as string[],
  stored: new Map<string, Blob>(),
  turns: {} as Record<string, unknown>,
}));

vi.mock('../src/lib/if/engine', () => ({
  createEngine: () => ({
    start: async () => fake.turns.start,
    send: async (command: string) => {
      fake.sent.push(command);
      return fake.turns[command.toLowerCase()] ?? { text: `Nothing happens.`, status: { location: 'West of House', score: 0, moves: 1 }, finished: false };
    },
    save: () => new Uint8Array([1, 2, 3]),
    restore: async () => fake.turns.start,
  }),
}));
vi.mock('../src/scripts/openrouter', () => ({
  createOpenRouter: () => ({
    image: async (_model: string, prompt: string) => {
      fake.images.push(prompt);
      return { ok: true, value: new Blob(['png'], { type: 'image/png' }) };
    },
    video: async (_model: string, prompt: string) => {
      fake.videos.push(prompt);
      return { ok: true, value: new Blob(['mp4'], { type: 'video/mp4' }) };
    },
  }),
}));
vi.mock('../src/scripts/media-store', () => ({
  createMediaStore: () => ({
    get: async (k: unknown) => fake.stored.get(JSON.stringify(k)) ?? null,
    put: async (k: unknown, b: Blob) => void fake.stored.set(JSON.stringify(k), b),
  }),
}));

const turn = (location: string, text: string, score = 0): Turn => ({ text, status: { location, score, moves: 1 }, finished: false });
const WEST = 'West of House\nYou are standing in an open field west of a white house, with a boarded front door.\nThere is a small mailbox here.';
const NORTH = 'North of House\nYou are facing the north side of a white house. There is no door here.';

const root = () => document.querySelector<HTMLElement>('[data-game]')!;
const q = <T extends HTMLElement>(sel: string) => root().querySelector<T>(sel)!;
const logText = () => q('[data-log]').textContent ?? '';
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

async function type(command: string): Promise<void> {
  const input = q<HTMLInputElement>('[data-input]');
  input.value = command;
  q<HTMLFormElement>('[data-form]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(fake.sent).toContain(command));
  await settle();
}

let page = '';
beforeAll(async () => {
  page = await vi.waitFor(() => read('index.html'), { timeout: 60_000, interval: 250 });
}, 65_000);

async function boot(opts: { key?: string | null; consented?: boolean } = {}): Promise<void> {
  const settings = { ...defaultSettings(), key: opts.key === undefined ? 'sk-or-test-key' : opts.key, consented: opts.consented ?? true };
  writeSettings(localStorage, settings);
  document.body.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/.exec(page)![1].replace(/<script[\s\S]*?<\/script>/g, '');
  vi.resetModules();
  await import('../src/scripts/main.ts');
  await vi.waitFor(() => expect(logText()).toContain('open field west of a white house'));
  await settle();
}

beforeEach(() => {
  localStorage.clear();
  Object.assign(fake, { sent: [], images: [], videos: [], stored: new Map(), turns: {
    start: turn('West of House', `ZORK I\n${WEST}\n>`),
    'open mailbox': turn('West of House', 'Opening the small mailbox reveals a leaflet.'),
    look: turn('West of House', WEST),
    north: turn('North of House', NORTH),
    south: turn('West of House', WEST),
  } });
  vi.stubGlobal('fetch', async () => new Response(new Uint8Array([3, 0, 0, 0]), { status: 200 }));
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
  window.matchMedia = globalThis.matchMedia;
  if (!URL.createObjectURL) URL.createObjectURL = () => 'blob:test';
  if (!URL.revokeObjectURL) URL.revokeObjectURL = () => {};
});

describe('Zork page', () => {
  it('boots to the opening text and one picture request for the first room', async () => {
    await boot();
    expect(logText()).toContain('open field west of a white house');
    expect(fake.images.length).toBe(1);
  });

  it('shows the reply to a typed command', async () => {
    await boot();
    await type('open mailbox');
    expect(logText()).toContain('> open mailbox');
    expect(logText()).toContain('Opening the small mailbox reveals a leaflet.');
  });

  it('makes no second picture request when the player stays in the same room', async () => {
    await boot();
    await type('open mailbox');
    await type('look');
    expect(fake.images.length).toBe(1);
  });

  it('makes a request for a new room, and none when returning to a room already pictured', async () => {
    await boot();
    await type('north');
    expect(fake.images.length).toBe(2);
    await type('south');
    expect(fake.images.length).toBe(2);
  });

  it('never puts what the player typed into a picture prompt', async () => {
    await boot();
    await type('open mailbox');
    await type('north');
    expect(fake.images.length).toBe(2);
    for (const prompt of fake.images) expect(prompt.toLowerCase()).not.toMatch(/open mailbox|> ?north/);
  });

  it('makes no request without a key, and the game still plays', async () => {
    await boot({ key: null });
    await type('open mailbox');
    expect(fake.images.length).toBe(0);
    expect(logText()).toContain('Opening the small mailbox');
    expect(q('[data-notice]').textContent).toMatch(/OpenRouter key/);
  });

  it('makes no request until the cost notice is accepted', async () => {
    await boot({ consented: false });
    expect(fake.images.length).toBe(0);
    expect(q('[data-notice]').textContent).toMatch(/cost notice/i);
  });

  it('keeps the key in the settings key only, and Forget key clears it', async () => {
    await boot();
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).key).toBe('sk-or-test-key');
    expect(localStorage.getItem(GAME_SAVE_KEY) ?? '').not.toContain('sk-or-test-key');
    q('[data-act="forget"]').click();
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).key).toBeNull();
    expect(q<HTMLInputElement>('[data-key]').value).toBe('');
  });

  it('saves the game under cls.if-zork after a move', async () => {
    await boot();
    await type('north');
    expect(JSON.parse(localStorage.getItem(GAME_SAVE_KEY)!).version).toBe(1);
  });
});
