// Ties the engine, event detector, spend guard, OpenRouter client and media store to the page. Text is shown
// the moment the engine answers; pictures and clips arrive later and never block the next command. At most one
// image request runs at a time and a newer room replaces a queued older one. Player-typed commands are never
// put in a prompt: prompts use the room name, the game's own room text (or the prebuilt prompt for that room) and the
// player's own description, with the echoed command removed.
//
// Pictures follow the state of the place. A room starts with its prebuilt prompt. When the game prints the text of a
// "moment" for the room (the rug moved, the lamp lit...), the moment fires once per game and the room's picture
// becomes a new one, drawn from the room prompt plus the changes so far and, when the earlier picture is stored, with
// that picture as a reference. Pictures are stored under the state they show, so from then on every visit (and every
// redraw, in any style) uses the changed one, while the earlier ones stay stored and unshown.
import type { Engine } from '../lib/if/engine';
import { cleanPlayerPrompt, mediaNamespace } from '../lib/if/player';
import { buildImagePrompt, buildVideoPrompt } from '../lib/if/prompt';
import { NO_SCENES, ZORK_SCENES, type SceneData } from '../lib/if/scenes';
import type { Settings } from '../lib/if/settings';
import { STYLES } from '../lib/if/styles';
import type { GameEvent, GameId, Turn } from '../lib/if/types';
import type { MediaKey } from './media-store';
import type { MediaFailure, MediaResult, OpenRouterClient } from './openrouter';
import type { IfUi } from './ui';

type Detector = { next(turn: Turn): GameEvent[] };
type Guard = { canImage(): boolean; canVideo(): boolean; noteImage(): void; noteVideo(): void };
type Store = { get(k: MediaKey): Promise<Blob | null>; put(k: MediaKey, b: Blob): Promise<void> };
// `scene` is the prebuilt prompt for a known place, else the game's own text; `dark` is true while the place is
// unlit (a known dark place entered without a lamp).
type Room = { id: string; name: string; text: string; scene: string; dark: boolean };

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
  /** Prebuilt room and moment prompts; Zork I's own by default. */
  scenes?: SceneData;
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
  const scenes = d.scenes ?? (game === 'zork' ? ZORK_SCENES : NO_SCENES);
  let room: Room | null = null;
  let pendingImage: { room: Room; from?: string } | null = null;
  /** Fired moment ids per room id (in firing order), and overall (in firing order, for the game save). */
  const firedByRoom = new Map<string, string[]>();
  const firedOrder: string[] = [];
  let imageBusy = false;
  let videoBusy = false;
  let active = 0;
  const inflight = new Set<Promise<void>>();

  const currentStyle = () => settings.styleByGame[game] ?? STYLES[0].id;
  const playerPrompt = () => cleanPlayerPrompt(settings.playerPrompt);
  /** The cache namespace in force now: the style plus a hash of the player's description. */
  const currentNamespace = () => mediaNamespace(currentStyle(), playerPrompt());
  const isCurrent = (id: string, namespace: string) => room?.id === id && currentNamespace() === namespace;
  const firedIn = (roomId: string) => firedByRoom.get(roomId) ?? [];
  /** The id the room's picture is stored under: the place itself, or the place as changed by its fired moments. */
  const stateId = (r: Room) => (r.dark ? `${r.id}|dark` : firedIn(r.id).length ? `${r.id}|m|${firedIn(r.id).join('+')}` : r.id);

  function fire(m: { id: string; roomId: string }): void {
    firedOrder.push(m.id);
    firedByRoom.set(m.roomId, [...firedIn(m.roomId), m.id]);
  }

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
    /** Whether what this job makes is still what the player is looking at. */
    current: () => boolean;
    /** Whether a refusal (no key, consent, cap) is explained to the player. */
    explainBlocked: boolean;
    note: () => void;
    call: () => Promise<MediaResult<Blob>>;
    show: (b: Blob) => void;
  };

  /** The one paid-media pipeline: cache, spend gate, cap count, key capture, stale-key drop, failure notice, store. */
  async function runPaid(job: PaidJob): Promise<void> {
    const { key, show } = job;
    const cached = await store.get(key);
    if (cached) {
      if (job.current()) show(cached);
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
        if (job.current()) ui.showNotice(FAILURE[res.reason]);
        return;
      }
      await store.put(key, res.value);
      if (job.current()) show(res.value);
    } finally {
      end();
    }
  }

  function runImage(job: Room, from?: string): Promise<void> {
    const styleId = currentStyle();
    const player = playerPrompt();
    const namespace = mediaNamespace(styleId, player);
    const id = stateId(job);
    const dark = job.dark;
    const changes = dark ? [] : firedIn(job.id).flatMap((m) => scenes.moment(m)?.prompt ?? []);
    const current = () => room?.id === job.id && currentNamespace() === namespace && stateId(room) === id;
    return runPaid({
      kind: 'image',
      key: { game, styleId: namespace, kind: 'image', id },
      current,
      explainBlocked: current(),
      note: () => guard.noteImage(),
      call: async () => {
        // The picture this one replaces, when it is stored, goes along as a reference; models that cannot use one
        // ignore it or the client drops it, and the prompt alone (room prompt plus the change) carries the scene.
        const reference = from && from !== id ? await store.get({ game, styleId: namespace, kind: 'image', id: from }) : null;
        const prompt = buildImagePrompt({ game, styleId, roomName: job.name, text: job.scene, playerPrompt: player, changes, dark });
        return openrouter.image(settings.imageModel, prompt, undefined, reference ?? undefined);
      },
      show: (b) => ui.showImage(b),
    });
  }

  function pump(): void {
    if (imageBusy || !pendingImage) return;
    const { room: job, from } = pendingImage;
    pendingImage = null;
    imageBusy = true;
    track(
      runImage(job, from).finally(() => {
        imageBusy = false;
        pump();
      }),
    );
  }

  function queueImage(job: Room, from?: string): void {
    pendingImage = { room: job, from };
    pump();
  }

  function eventOf(kind: GameEvent['kind'], r: Room, text: string): GameEvent {
    if (kind === 'scoreGain') return { kind, delta: 0, text };
    if (kind === 'newRoom') return { kind, roomId: r.id, roomName: r.name, text };
    return { kind, text };
  }

  async function runVideo(kind: GameEvent['kind'], r: Room, text: string, id: string, manual: boolean): Promise<void> {
    const styleId = currentStyle();
    const player = playerPrompt();
    try {
      await runPaid({
        kind: 'video',
        key: { game, styleId: mediaNamespace(styleId, player), kind: 'video', id },
        current: () => isCurrent(r.id, mediaNamespace(styleId, player)),
        explainBlocked: manual,
        note: () => guard.noteVideo(),
        call: () =>
          openrouter.video(
            settings.videoModel,
            buildVideoPrompt({ game, styleId, roomName: r.name, event: eventOf(kind, r, text), playerPrompt: player }),
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
    if (!room || !guard.canVideo()) return;
    // Automatic clips are skipped quietly when not allowed; only the Make a video button explains why.
    if (ev.kind === 'scoreGain') void startVideo('scoreGain', room, room.scene, `${room.id}|score|${score ?? 0}`, false);
    else if (ev.kind !== 'newRoom') void startVideo(ev.kind, room, shown, `${room.id}|${ev.kind}`, false);
  }

  function enter(ev: Extract<GameEvent, { kind: 'newRoom' }>, shown: string): Room {
    const known = scenes.room(ev.roomId);
    const text = sceneOf(shown, ev.roomName);
    return {
      id: ev.roomId,
      name: ev.roomName,
      text,
      scene: known?.prompt ?? text,
      dark: !!known?.dark && /pitch black/i.test(shown),
    };
  }

  function handle(t: Turn, command?: string): void {
    const shown = cleanText(t.text, command);
    if (shown) ui.showText(shown);
    const events = detector.next(t);
    const arrived = events.find((e): e is Extract<GameEvent, { kind: 'newRoom' }> => e.kind === 'newRoom');
    if (arrived) room = enter(arrived, shown);
    // Moments: the game's text for a visible change in the place the player is in. Fired ones never fire again.
    const hits = room ? scenes.matching(room.id, shown, new Set(firedOrder)) : [];
    const before = room ? stateId(room) : undefined;
    for (const m of hits) fire(m);
    if (room && hits.length) room.dark = false;
    // One picture request per turn, for the place as it now looks.
    if (room && (arrived || hits.length)) queueImage(room, hits.length ? before : undefined);
    for (const ev of events) onEvent(ev, shown, t.status?.score);
  }

  return {
    /** Starts the game; with saved bytes it restores that position and looks around instead of showing the banner. */
    async start(saved?: Uint8Array, moments: readonly string[] = []): Promise<void> {
      let turn = await engine.start();
      let command: string | undefined;
      if (saved) {
        try {
          await engine.restore(saved);
          turn = await engine.send('look');
          command = 'look';
          // The moments already seen in the saved game: they are part of how its places look and never fire again.
          for (const id of moments) {
            const m = scenes.moment(id);
            if (m && !firedOrder.includes(id)) fire(m);
          }
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
      await startVideo('newRoom', room, room.scene, `${room.id}|manual`, true);
    },
    /** Ids of the moments that have fired in this game, in order, for the game save. */
    firedMoments(): string[] {
      return [...firedOrder];
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
