// Ties the engine, event detector, spend guard, OpenRouter client and media store to the page. Text is shown
// the moment the engine answers; pictures and clips arrive later and never block the next command. At most one
// image request runs at a time and a newer room replaces a queued older one. Player-typed commands are never
// put in a prompt: prompts use the room name and the game's own room text only, with the echoed command removed.
import type { Engine } from '../lib/if/engine';
import { buildImagePrompt, buildVideoPrompt } from '../lib/if/prompt';
import type { Settings } from '../lib/if/settings';
import { STYLES } from '../lib/if/styles';
import type { GameEvent, GameId, Turn } from '../lib/if/types';
import type { MediaKey } from './media-store';
import type { MediaFailure, MediaResult, OpenRouterClient } from './openrouter';
import type { IfUi } from './ui';

type Detector = { next(turn: Turn): GameEvent[] };
type Guard = { canImage(): boolean; canVideo(): boolean; noteImage(): void; noteVideo(): void };
type Store = { get(k: MediaKey): Promise<Blob | null>; put(k: MediaKey, b: Blob): Promise<void> };
type Room = { id: string; name: string; text: string };

export interface ControllerDeps {
  engine: Pick<Engine, 'start' | 'send' | 'restore'>;
  detector: Detector;
  /** Shared, mutable: the settings panel changes it (key, models, consent) and the controller reads it live. */
  settings: Settings;
  guard: Guard;
  openrouter: OpenRouterClient;
  store: Store;
  ui: IfUi;
  game: GameId;
}

export const NOTICE = {
  noKey: 'Add an OpenRouter key in Settings to see pictures. The game plays on without one.',
  consent: 'Read and accept the cost notice in Settings to turn on pictures and videos.',
  imageCap: 'Picture limit for this session reached. Reload the page to start a new session.',
  videoCap: 'Video limit for this session reached. Reload the page to start a new session.',
  noRoom: 'Play a move first, then there is a place to film.',
  videoBusy: 'A video is already being made.',
} as const;

const FAILURE: Record<MediaFailure, string> = {
  'no-key': NOTICE.noKey,
  auth: 'OpenRouter did not accept the key. Check it in Settings.',
  credit: 'OpenRouter says the account is out of credit.',
  rate: 'OpenRouter is busy (rate limit). Try again in a moment.',
  refused: 'The model refused this request, or the model name is wrong.',
  network: 'Could not reach OpenRouter. The game plays on.',
  timeout: 'The video took too long to make.',
  'bad-response': 'OpenRouter sent back something unexpected.',
};

/** Game text without the echoed command line and the trailing ">" prompt. */
export function cleanText(text: string, command?: string): string {
  const lines = text.replace(/(^|\n)[ \t]*>[ \t]*$/, '').split('\n');
  if (command && lines[0]?.trim().toLowerCase() === command.trim().toLowerCase()) lines.shift();
  return lines.join('\n').trim();
}

// The room description is what follows the room-name line; anything before it (a title banner) is left out.
function sceneOf(text: string, roomName: string): string {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l.trim().toLowerCase() === roomName.trim().toLowerCase());
  return (at >= 0 ? lines.slice(at + 1) : lines).join('\n').trim();
}

export function createController(d: ControllerDeps) {
  const { engine, detector, settings, guard, openrouter, store, ui, game } = d;
  let room: Room | null = null;
  let pendingImage: Room | null = null;
  let imageBusy = false;
  let videoBusy = false;
  let active = 0;
  const inflight = new Set<Promise<void>>();

  const currentStyle = () => settings.styleByGame[game] ?? STYLES[0].id;
  const isCurrent = (id: string, styleId: string) => room?.id === id && currentStyle() === styleId;

  function track(p: Promise<void>): void {
    inflight.add(p);
    void p.finally(() => inflight.delete(p));
  }
  function begin(): void {
    if (active++ === 0) ui.setBusy(true);
  }
  function end(): void {
    if (--active === 0) ui.setBusy(false);
  }

  /** null when a paid call may go ahead, else the one-line reason it may not. */
  function blocked(kind: 'image' | 'video'): string | null {
    if (kind === 'image' ? guard.canImage() : guard.canVideo()) return null;
    if (!settings.key) return NOTICE.noKey;
    if (!settings.consented) return NOTICE.consent;
    return kind === 'image' ? NOTICE.imageCap : NOTICE.videoCap;
  }

  type PaidJob = {
    kind: 'image' | 'video';
    key: MediaKey;
    roomId: string;
    /** Whether a refusal (no key, consent, cap) is explained to the player. */
    explainBlocked: boolean;
    note: () => void;
    call: () => Promise<MediaResult<Blob>>;
    show: (b: Blob) => void;
  };

  /** The one paid-media pipeline: cache, spend gate, cap count, key capture, stale-key drop, failure notice, store. */
  async function runPaid(job: PaidJob): Promise<void> {
    const { key, roomId, show } = job;
    const styleId = key.styleId;
    const cached = await store.get(key);
    if (cached) {
      if (isCurrent(roomId, styleId)) show(cached);
      return;
    }
    const why = blocked(job.kind);
    if (why) {
      if (job.explainBlocked) ui.showNotice(why);
      return;
    }
    job.note();
    const apiKey = settings.key;
    begin();
    try {
      const res = await job.call();
      // Key forgotten or replaced while the request ran: drop the result unseen.
      if (!settings.key || settings.key !== apiKey) return;
      if (!res.ok) {
        if (isCurrent(roomId, styleId)) ui.showNotice(FAILURE[res.reason]);
        return;
      }
      await store.put(key, res.value);
      if (isCurrent(roomId, styleId)) show(res.value);
    } finally {
      end();
    }
  }

  function runImage(job: Room): Promise<void> {
    const styleId = currentStyle();
    return runPaid({
      kind: 'image',
      key: { game, styleId, kind: 'image', id: job.id },
      roomId: job.id,
      explainBlocked: isCurrent(job.id, styleId),
      note: () => guard.noteImage(),
      call: () =>
        openrouter.image(settings.imageModel, buildImagePrompt({ game, styleId, roomName: job.name, text: job.text })),
      show: (b) => ui.showImage(b),
    });
  }

  function pump(): void {
    if (imageBusy || !pendingImage) return;
    const job = pendingImage;
    pendingImage = null;
    imageBusy = true;
    track(
      runImage(job).finally(() => {
        imageBusy = false;
        pump();
      }),
    );
  }

  function queueImage(job: Room): void {
    pendingImage = job;
    pump();
  }

  function eventOf(kind: GameEvent['kind'], r: Room, text: string): GameEvent {
    if (kind === 'scoreGain') return { kind, delta: 0, text };
    if (kind === 'newRoom') return { kind, roomId: r.id, roomName: r.name, text };
    return { kind, text };
  }

  async function runVideo(kind: GameEvent['kind'], r: Room, text: string, id: string, manual: boolean): Promise<void> {
    const styleId = currentStyle();
    try {
      await runPaid({
        kind: 'video',
        key: { game, styleId, kind: 'video', id },
        roomId: r.id,
        explainBlocked: manual,
        note: () => guard.noteVideo(),
        call: () =>
          openrouter.video(
            settings.videoModel,
            buildVideoPrompt({ game, styleId, roomName: r.name, event: eventOf(kind, r, text) }),
          ),
        show: (b) => ui.showVideo(b),
      });
    } finally {
      videoBusy = false;
    }
  }

  function startVideo(kind: GameEvent['kind'], r: Room, text: string, id: string, manual: boolean): Promise<void> {
    if (videoBusy) {
      if (manual) ui.showNotice(NOTICE.videoBusy);
      return Promise.resolve();
    }
    videoBusy = true;
    const p = runVideo(kind, r, text, id, manual);
    track(p);
    return p;
  }

  function onEvent(ev: GameEvent, shown: string, score: number | undefined): void {
    if (ev.kind === 'newRoom') {
      room = { id: ev.roomId, name: ev.roomName, text: sceneOf(shown, ev.roomName) };
      queueImage(room);
      return;
    }
    if (!room || !guard.canVideo()) return;
    // Automatic clips are skipped quietly when not allowed; only the Make a video button explains why.
    if (ev.kind === 'scoreGain') void startVideo('scoreGain', room, room.text, `${room.id}|score|${score ?? 0}`, false);
    else void startVideo(ev.kind, room, shown, `${room.id}|${ev.kind}`, false);
  }

  function handle(t: Turn, command?: string): void {
    const shown = cleanText(t.text, command);
    if (shown) ui.showText(shown);
    for (const ev of detector.next(t)) onEvent(ev, shown, t.status?.score);
  }

  return {
    /** Starts the game; with saved bytes it restores that position and looks around instead of showing the banner. */
    async start(saved?: Uint8Array): Promise<void> {
      let turn = await engine.start();
      let command: string | undefined;
      if (saved) {
        try {
          await engine.restore(saved);
          turn = await engine.send('look');
          command = 'look';
        } catch {
          // A save the game cannot read: the game begins from the top.
        }
      }
      handle(turn, command);
    },
    async command(text: string): Promise<void> {
      if (text.trim() === '') return;
      handle(await engine.send(text), text);
    },
    async requestVideo(): Promise<void> {
      if (!room) {
        ui.showNotice(NOTICE.noRoom);
        return;
      }
      await startVideo('newRoom', room, room.text, `${room.id}|manual`, true);
    },
    /** Asks again for the current room's picture, e.g. after a failure notice. */
    retryImage(): void {
      if (room) queueImage(room);
    },
    setStyle(id: string): void {
      if (!STYLES.some((s) => s.id === id)) return;
      settings.styleByGame[game] = id;
      if (room) queueImage(room);
    },
    /** Resolves when no picture or clip is queued or running. */
    async idle(): Promise<void> {
      while (inflight.size) await Promise.all([...inflight]);
    },
  };
}
