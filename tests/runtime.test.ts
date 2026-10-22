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

async function boot(opts: { key?: string | null; consented?: boolean; playerPrompt?: string } = {}): Promise<void> {
  const settings = { ...defaultSettings(), key: opts.key === undefined ? 'sk-or-test-key' : opts.key, consented: opts.consented ?? true, playerPrompt: opts.playerPrompt ?? '' };
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

  describe('player description', () => {
    const field = () => q<HTMLTextAreaElement>('[data-player-prompt]');
    const edit = (value: string, event: 'input' | 'change' | 'blur' = 'change') => {
      field().value = value;
      field().dispatchEvent(new Event(event, { bubbles: true }));
    };
    const stored = () => JSON.parse(localStorage.getItem(SETTINGS_KEY)!);

    it('has a labelled textarea limited to 500 characters, with an example and helper text', async () => {
      await boot();
      const f = field();
      expect(f.tagName).toBe('TEXTAREA');
      expect(f.getAttribute('maxlength')).toBe('500');
      expect(root().querySelector(`label[for="${f.id}"]`)?.textContent).toMatch(/About you and how it should look/);
      expect(f.getAttribute('placeholder')).toMatch(/woman adventurer/);
      const hint = document.getElementById(f.getAttribute('aria-describedby')!.split(' ')[0])!;
      expect(hint.textContent).toMatch(/sent to OpenRouter and the model provider with each picture request/);
    });

    it('persists on change and on blur, cleaned, without touching the game save', async () => {
      await boot();
      edit('  I am a hiker\n in boots ');
      expect(stored().playerPrompt).toBe('I am a hiker in boots');
      expect(field().value).toBe('I am a hiker in boots');
      edit('Plus a hat', 'blur');
      expect(stored().playerPrompt).toBe('Plus a hat');
      expect(localStorage.getItem(GAME_SAVE_KEY) ?? '').not.toContain('hat');
    });

    it('shows a saved description on load and sends it with the first picture', async () => {
      await boot({ playerPrompt: 'I am a hiker' });
      expect(field().value).toBe('I am a hiker');
      expect(fake.images[0]).toContain('--- Player description ---\nI am a hiker\n');
    });

    it('keeps the live character count out of the live region until the field is committed', async () => {
      await boot();
      const visible = q('[data-player-count]');
      const live = q('[data-player-count-live]');
      expect(live.getAttribute('role')).toBe('status');
      expect(live.getAttribute('aria-live')).toBe('polite');
      expect(visible.closest('[aria-live]')).toBeNull();
      expect(visible.textContent).toMatch(/0 of 500/);
      field().value = 'twelve chars';
      field().dispatchEvent(new Event('input', { bubbles: true }));
      expect(visible.textContent).toMatch(/12 of 500/);
      expect(live.textContent).toBe('');
      field().dispatchEvent(new Event('change', { bubbles: true }));
      expect(live.textContent).toMatch(/12 of 500/);
    });

    it('draws the current place again with the description when Redraw picture is pressed', async () => {
      await boot();
      await type('open mailbox');
      expect(fake.images.length).toBe(1);
      edit('I am a woman adventurer dressed for a day of hiking.');
      q('[data-act="retry"]').click();
      await vi.waitFor(() => expect(fake.images.length).toBe(2));
      expect(fake.images[1]).toContain('woman adventurer dressed for a day of hiking');
      expect(fake.images[1]).toContain('Place: West of House.');
      expect(fake.images[0]).not.toContain('Player description');
      // Pressing Redraw straight after typing (no blur yet) still uses the typed text.
      field().value = 'I carry a red lantern';
      q('[data-act="retry"]').click();
      await vi.waitFor(() => expect(fake.images.length).toBe(3));
      expect(fake.images[2]).toContain('I carry a red lantern');
    });

    it('sends the description but never a typed command, in pictures or videos', async () => {
      await boot();
      edit('I am a hiker');
      await type('open mailbox');
      await type('north');
      q('[data-act="video"]').click();
      await vi.waitFor(() => expect(fake.videos.length).toBe(1));
      for (const p of [...fake.images.slice(1), ...fake.videos]) {
        expect(p).toContain('I am a hiker');
        expect(p.toLowerCase()).not.toMatch(/open mailbox|> ?north/);
      }
    });
  });
});
