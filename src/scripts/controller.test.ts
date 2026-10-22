import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { createDetector } from '../lib/if/events';
import { createEngine } from '../lib/if/engine';
import { createSpendGuard, defaultSettings, type Settings } from '../lib/if/settings';
import type { Turn } from '../lib/if/types';
import type { MediaKey } from './media-store';
import type { MediaResult } from './openrouter';
import { createSceneData, ZORK_SCENES, type SceneData } from '../lib/if/scenes';
import { cleanText, createController } from './controller';

const turn = (room: string, score: number, body: string, extra: Partial<Turn> = {}): Turn => ({
  text: body,
  status: { location: room, score, moves: 1 },
  finished: false,
  ...extra,
});
const blob = (tag: string) => new Blob([tag], { type: 'image/png' });
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

function rig(opts: { settings?: Partial<Settings>; turns?: Turn[]; scenes?: SceneData } = {}) {
  const log: string[] = [];
  const settings: Settings = { ...defaultSettings(), key: 'sk-test', consented: true, ...opts.settings };
  const guard = createSpendGuard(settings);
  const queue = [...(opts.turns ?? [])];
  const sent: string[] = [];
  const engine = {
    start: vi.fn(async () => queue.shift()!),
    send: vi.fn(async (c: string) => {
      sent.push(c);
      return queue.shift()!;
    }),
    save: vi.fn(() => new Uint8Array(0)),
    restore: vi.fn(async () => queue.shift()!),
  };
  const ui = {
    showText: vi.fn((t: string) => void log.push(`text:${t}`)),
    showImage: vi.fn((b: Blob | null) => void log.push(`show-image:${b ? 'blob' : 'null'}`)),
    showVideo: vi.fn((_b: Blob) => void log.push('show-video')),
    showNotice: vi.fn((m: string) => void log.push(`notice:${m}`)),
    setBusy: vi.fn((_b: boolean) => undefined),
  };
  const stored = new Map<string, Blob>();
  const keyOf = (k: MediaKey) => `${k.game}|${k.styleId}|${k.kind}|${k.id}`;
  const store = {
    get: vi.fn(async (k: MediaKey) => stored.get(keyOf(k)) ?? null),
    put: vi.fn(async (k: MediaKey, b: Blob) => void stored.set(keyOf(k), b)),
  };
  const prompts: string[] = [];
  const openrouter = {
    image: vi.fn(async (_m: string, p: string, _signal?: AbortSignal, _reference?: Blob): Promise<MediaResult<Blob>> => {
      log.push('image');
      prompts.push(p);
      return { ok: true, value: blob('img') };
    }),
    video: vi.fn(async (_m: string, p: string): Promise<MediaResult<Blob>> => {
      log.push('video');
      prompts.push(p);
      return { ok: true, value: blob('vid') };
    }),
  };
  const controller = createController({ engine, detector: createDetector(), settings, guard, openrouter, store, ui, game: 'zork', scenes: opts.scenes });
  return { controller, engine, ui, store, stored, openrouter, settings, guard, log, prompts, sent, queue };
}

describe('createController', () => {
  it('text_shown_before_image_requested', async () => {
    const r = rig({ turns: [turn('West of House', 0, 'start\n\n>'), turn('North of House', 0, 'north\nYou are north of the house.\n\n>')] });
    await r.controller.start();
    await r.controller.idle();
    r.log.length = 0;
    await r.controller.command('north');
    await r.controller.idle();
    expect(r.log.indexOf('text:You are north of the house.')).toBe(0);
    expect(r.log.indexOf('image')).toBeGreaterThan(0);
  });

  it('new_room_requests_image_once_then_uses_cache', async () => {
    const r = rig({
      turns: [
        turn('West of House', 0, 'a'),
        turn('North of House', 0, 'b'),
        turn('West of House', 0, 'c'),
        turn('North of House', 0, 'd'),
      ],
    });
    await r.controller.start();
    await r.controller.idle();
    await r.controller.command('north');
    await r.controller.idle();
    await r.controller.command('south');
    await r.controller.idle();
    await r.controller.command('north');
    await r.controller.idle();
    expect(r.openrouter.image).toHaveBeenCalledTimes(2);
    expect(r.ui.showImage).toHaveBeenCalledTimes(4);
    expect(r.ui.showImage.mock.calls.every((c) => c[0] instanceof Blob)).toBe(true);
  });

  it('scoreGain_requests_video_when_allowed', async () => {
    const r = rig({ turns: [turn('Living Room', 0, 'a'), turn('Living Room', 5, 'Taken.')] });
    await r.controller.start();
    await r.controller.command('take lamp');
    await r.controller.idle();
    expect(r.openrouter.video).toHaveBeenCalledTimes(1);
    expect(r.openrouter.video.mock.calls[0][0]).toBe(r.settings.videoModel);
    expect(r.ui.showVideo).toHaveBeenCalledTimes(1);
  });

  it('scoreGain_skips_video_when_video_cap_is_zero', async () => {
    const r = rig({ settings: { maxVideos: 0 }, turns: [turn('Living Room', 0, 'a'), turn('Living Room', 5, 'Taken.')] });
    await r.controller.start();
    await r.controller.command('take lamp');
    await r.controller.idle();
    expect(r.openrouter.video).not.toHaveBeenCalled();
  });

  it('no_key_shows_notice_and_plays_on', async () => {
    const r = rig({ settings: { key: null }, turns: [turn('West of House', 0, 'a'), turn('North of House', 0, 'You are north.')] });
    await r.controller.start();
    await r.controller.command('north');
    await r.controller.idle();
    expect(r.ui.showText).toHaveBeenCalledWith('You are north.');
    expect(r.openrouter.image).not.toHaveBeenCalled();
    expect(r.ui.showNotice.mock.calls.some((c) => /key/i.test(c[0]))).toBe(true);
  });

  it('cost_notice_not_accepted_shows_notice_and_makes_no_call', async () => {
    const r = rig({ settings: { consented: false }, turns: [turn('West of House', 0, 'a')] });
    await r.controller.start();
    await r.controller.idle();
    expect(r.openrouter.image).not.toHaveBeenCalled();
    expect(r.ui.showNotice.mock.calls.some((c) => /cost/i.test(c[0]))).toBe(true);
  });

  it('cap_reached_skips_generation_with_notice', async () => {
    const r = rig({ settings: { maxImages: 1 }, turns: [turn('West of House', 0, 'a'), turn('North of House', 0, 'b')] });
    await r.controller.start();
    await r.controller.idle();
    await r.controller.command('north');
    await r.controller.idle();
    expect(r.openrouter.image).toHaveBeenCalledTimes(1);
    expect(r.ui.showNotice.mock.calls.some((c) => /limit/i.test(c[0]))).toBe(true);
  });

  it('failed_image_shows_notice_and_keeps_last_picture', async () => {
    const r = rig({ turns: [turn('West of House', 0, 'a'), turn('North of House', 0, 'b')] });
    await r.controller.start();
    await r.controller.idle();
    r.openrouter.image.mockResolvedValueOnce({ ok: false, reason: 'credit' });
    await r.controller.command('north');
    await r.controller.idle();
    expect(r.ui.showImage).toHaveBeenCalledTimes(1);
    expect(r.ui.showImage).not.toHaveBeenCalledWith(null);
    expect(r.ui.showNotice.mock.calls.some((c) => /credit/i.test(c[0]))).toBe(true);
    expect(r.store.put).toHaveBeenCalledTimes(1);
  });

  it('request_video_button_uses_current_room', async () => {
    const r = rig({ turns: [turn('Troll Room', 0, 'A nasty troll blocks the way.')] });
    await r.controller.start();
    await r.controller.idle();
    await r.controller.requestVideo();
    expect(r.openrouter.video).toHaveBeenCalledTimes(1);
    expect(r.prompts[r.prompts.length - 1]).toContain('Troll Room');
    expect(r.ui.showVideo).toHaveBeenCalledTimes(1);
  });

  it('request_video_before_any_room_shows_notice', async () => {
    const r = rig();
    await r.controller.requestVideo();
    expect(r.openrouter.video).not.toHaveBeenCalled();
    expect(r.ui.showNotice).toHaveBeenCalledTimes(1);
  });

  it('style_change_uses_new_cache_namespace', async () => {
    const r = rig({ turns: [turn('West of House', 0, 'a')] });
    await r.controller.start();
    await r.controller.idle();
    r.controller.setStyle('anime');
    await r.controller.idle();
    expect(r.settings.styleByGame.zork).toBe('anime');
    expect(r.openrouter.image).toHaveBeenCalledTimes(2);
    const styles = r.store.get.mock.calls.map((c) => c[0].styleId);
    expect(styles).toContain('anime');
    expect([...r.stored.keys()].sort()).toEqual(['zork|anime|image|west of house', 'zork|cartoon|image|west of house']);
  });

  it('unknown_style_is_ignored', async () => {
    const r = rig({ turns: [turn('West of House', 0, 'a')] });
    await r.controller.start();
    await r.controller.idle();
    r.controller.setStyle('not-a-style');
    await r.controller.idle();
    expect(r.settings.styleByGame.zork).toBeUndefined();
    expect(r.openrouter.image).toHaveBeenCalledTimes(1);
  });

  it('result_after_key_forgotten_is_discarded', async () => {
    const r = rig({ turns: [turn('West of House', 0, 'a')] });
    const d = deferred<MediaResult<Blob>>();
    r.openrouter.image.mockReturnValueOnce(d.promise);
    await r.controller.start();
    await vi.waitFor(() => expect(r.openrouter.image).toHaveBeenCalled());
    r.settings.key = null;
    d.resolve({ ok: true, value: blob('late') });
    await r.controller.idle();
    expect(r.store.put).not.toHaveBeenCalled();
    expect(r.ui.showImage).not.toHaveBeenCalled();
    expect(r.ui.showNotice).not.toHaveBeenCalled();
  });

  it('video_result_after_key_forgotten_is_discarded', async () => {
    const r = rig({ turns: [turn('Troll Room', 0, 'A nasty troll blocks the way.')] });
    await r.controller.start();
    await r.controller.idle();
    const d = deferred<MediaResult<Blob>>();
    r.openrouter.video.mockReturnValueOnce(d.promise);
    const pending = r.controller.requestVideo();
    await vi.waitFor(() => expect(r.openrouter.video).toHaveBeenCalled());
    r.settings.key = null;
    d.resolve({ ok: true, value: blob('late') });
    await pending;
    await r.controller.idle();
    expect(r.store.put.mock.calls.some((c) => c[0].kind === 'video')).toBe(false);
    expect(r.ui.showVideo).not.toHaveBeenCalled();
    expect(r.ui.showNotice).not.toHaveBeenCalled();
  });

  it('no_player_command_text_in_any_prompt', async () => {
    const r = rig({
      settings: { playerPrompt: 'I am a woman adventurer dressed for a day of hiking.' },
      turns: [
        turn('West of House', 0, 'start'),
        turn('Living Room', 3, 'xyzzy-secret-word\nYou are in the living room.\n\n>'),
      ],
    });
    await r.controller.start();
    await r.controller.idle();
    await r.controller.command('xyzzy-secret-word');
    await r.controller.idle();
    await r.controller.requestVideo();
    expect(r.openrouter.image.mock.calls.length + r.openrouter.video.mock.calls.length).toBeGreaterThanOrEqual(3);
    // The player's own description is sent with every request; the typed command never is.
    for (const p of r.prompts) {
      expect(p).toContain('woman adventurer dressed for a day of hiking');
      expect(p).not.toContain('secret');
    }
  });

  it('player_description_is_in_image_and_video_prompts_and_empty_changes_nothing', async () => {
    const withMe = rig({ settings: { playerPrompt: 'I am a hiker' }, turns: [turn('Living Room', 0, 'a'), turn('Living Room', 5, 'Taken.')] });
    await withMe.controller.start();
    await withMe.controller.command('take lamp');
    await withMe.controller.idle();
    expect(withMe.prompts.length).toBe(2);
    for (const p of withMe.prompts) expect(p).toContain('--- Player description ---\nI am a hiker\n');
    const without = rig({ turns: [turn('Living Room', 0, 'a')] });
    await without.controller.start();
    await without.controller.idle();
    expect(without.prompts[0]).not.toContain('Player description');
  });

  it('changed_description_uses_a_new_cache_namespace_and_keeps_the_old_picture', async () => {
    const r = rig({ turns: [turn('West of House', 0, 'a')] });
    await r.controller.start();
    await r.controller.idle();
    expect([...r.stored.keys()]).toEqual(['zork|cartoon|image|west of house']);
    r.settings.playerPrompt = 'I am a hiker';
    r.controller.retryImage();
    await r.controller.idle();
    expect(r.openrouter.image).toHaveBeenCalledTimes(2);
    const keys = [...r.stored.keys()].sort();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe('zork|cartoon.' + keys[0].split('.')[1]);
    expect(keys[1]).toBe('zork|cartoon|image|west of house');
    // Back to no description: the first picture is found again for free.
    r.settings.playerPrompt = '';
    r.controller.retryImage();
    await r.controller.idle();
    expect(r.openrouter.image).toHaveBeenCalledTimes(2);
    expect(r.ui.showImage).toHaveBeenCalledTimes(3);
  });

  it('a_picture_finishing_after_the_description_changed_is_stored_but_not_shown', async () => {
    const r = rig({ turns: [turn('West of House', 0, 'a')] });
    const d = deferred<MediaResult<Blob>>();
    r.openrouter.image.mockReturnValueOnce(d.promise);
    await r.controller.start();
    await vi.waitFor(() => expect(r.openrouter.image).toHaveBeenCalled());
    r.settings.playerPrompt = 'I am a hiker';
    d.resolve({ ok: true, value: blob('late') });
    await r.controller.idle();
    expect(r.stored.has('zork|cartoon|image|west of house')).toBe(true);
    expect(r.ui.showImage).not.toHaveBeenCalled();
  });

  it('empty_command_requests_nothing', async () => {
    const r = rig({ turns: [turn('West of House', 0, 'a')] });
    await r.controller.start();
    await r.controller.idle();
    const calls = r.openrouter.image.mock.calls.length;
    await r.controller.command('   ');
    await r.controller.idle();
    expect(r.engine.send).not.toHaveBeenCalled();
    expect(r.openrouter.image.mock.calls.length).toBe(calls);
  });

  it('newest_room_wins_while_an_image_is_in_flight', async () => {
    const r = rig({
      turns: [turn('Room A', 0, 'a'), turn('Room B', 0, 'b'), turn('Room C', 0, 'c')],
    });
    const d = deferred<MediaResult<Blob>>();
    r.openrouter.image.mockImplementationOnce((_m: string, p: string) => {
      r.prompts.push(p);
      return d.promise;
    });
    await r.controller.start();
    await vi.waitFor(() => expect(r.openrouter.image).toHaveBeenCalled());
    await r.controller.command('go b');
    await r.controller.command('go c');
    d.resolve({ ok: true, value: blob('a') });
    await r.controller.idle();
    expect(r.openrouter.image).toHaveBeenCalledTimes(2);
    expect(r.prompts[1]).toContain('Room C');
    expect(r.prompts.some((p) => p.includes('Room B'))).toBe(false);
    // Room A's picture is paid for, so it is kept, but it is not shown over the newer room.
    expect(r.stored.has('zork|cartoon|image|room a')).toBe(true);
    expect(r.ui.showImage).toHaveBeenCalledTimes(1);
  });

  it('retry_image_asks_again_for_the_current_room', async () => {
    const r = rig({ turns: [turn('West of House', 0, 'a')] });
    r.openrouter.image.mockResolvedValueOnce({ ok: false, reason: 'network' });
    await r.controller.start();
    await r.controller.idle();
    expect(r.ui.showImage).not.toHaveBeenCalled();
    r.controller.retryImage();
    await r.controller.idle();
    expect(r.openrouter.image).toHaveBeenCalledTimes(2);
    expect(r.ui.showImage).toHaveBeenCalledTimes(1);
  });

  it('start_with_saved_bytes_restores_and_looks_without_a_score_event', async () => {
    const r = rig({
      turns: [turn('West of House', 0, 'banner'), turn('Living Room', 0, 'restored'), turn('Living Room', 25, 'look\nYou are in the living room.\n\n>')],
    });
    await r.controller.start(new Uint8Array([1, 2, 3]));
    await r.controller.idle();
    expect(r.engine.restore).toHaveBeenCalledTimes(1);
    expect(r.sent).toEqual(['look']);
    expect(r.ui.showText).toHaveBeenCalledWith('You are in the living room.');
    expect(r.openrouter.video).not.toHaveBeenCalled();
    expect(r.openrouter.image).toHaveBeenCalledTimes(1);
  });
});

const tiny = () =>
  createSceneData(
    {
      'west of house': { prompt: 'A grassy field before a white house with a boarded door.' },
      cave: { prompt: 'A rough stone cave with a low roof.', dark: true },
      'north of house': { prompt: 'A blank white wall with boarded windows.' },
    },
    [
      { id: 'door-opened', roomId: 'west of house', when: 'the door swings open', prompt: 'Same view, but the front door now stands open.' },
      { id: 'light-on', roomId: 'cave', when: 'lantern is now on', prompt: 'Same view, but lit by a warm lantern glow.' },
      { id: 'shutter-open', roomId: 'west of house', when: 'shutter creaks open', prompt: 'Same view, but a shutter hangs open.' },
    ],
  );
const imageKeys = (r: ReturnType<typeof rig>) => [...r.stored.keys()].filter((k) => k.includes('|image|')).sort();

describe('prebuilt scene prompts', () => {
  it('a_known_room_is_drawn_from_its_prebuilt_prompt_not_the_game_text', async () => {
    const r = rig({ scenes: tiny(), turns: [turn('West of House', 0, 'ZORK banner\nWest of House\nYou are standing in an open field. TRADEMARK-TEXT')] });
    await r.controller.start();
    await r.controller.idle();
    expect(r.prompts[0]).toContain('Place: West of House.');
    expect(r.prompts[0]).toContain('Scene: A grassy field before a white house with a boarded door.');
    expect(r.prompts[0]).not.toContain('TRADEMARK-TEXT');
    expect(r.prompts[0]).not.toContain('Change:');
  });

  it('an_unknown_room_falls_back_to_the_game_text', async () => {
    const r = rig({ scenes: tiny(), turns: [turn('Mystery Hall', 0, 'Mystery Hall\nA hall of echoes.')] });
    await r.controller.start();
    await r.controller.idle();
    expect(r.prompts[0]).toContain('Scene: A hall of echoes.');
  });

  it('the_real_data_draws_the_living_room_from_its_prompt', async () => {
    const r = rig({ turns: [turn('Living Room', 0, 'Living Room\nYou are in the living room.')] });
    await r.controller.start();
    await r.controller.idle();
    expect(r.prompts[0]).toContain(`Scene: ${ZORK_SCENES.room('living room')!.prompt.slice(0, 80)}`);
  });

  it('a_moment_asks_for_a_new_picture_with_the_base_prompt_and_the_change_and_shows_it', async () => {
    const r = rig({ scenes: tiny(), turns: [turn('West of House', 0, 'West of House\nA field.'), turn('West of House', 0, 'open door\nWith a creak, the door swings open.\n\n>')] });
    await r.controller.start();
    await r.controller.idle();
    await r.controller.command('open door');
    await r.controller.idle();
    expect(r.openrouter.image).toHaveBeenCalledTimes(2);
    expect(r.prompts[1]).toContain('Scene: A grassy field before a white house with a boarded door.');
    expect(r.prompts[1]).toContain('Change: Same view, but the front door now stands open.');
    expect(r.ui.showImage).toHaveBeenCalledTimes(2);
  });

  it('the_changed_picture_replaces_the_rooms_picture_on_revisits_and_the_old_one_stays_stored', async () => {
    const r = rig({
      scenes: tiny(),
      turns: [
        turn('West of House', 0, 'West of House\nA field.'),
        turn('West of House', 0, 'open door\nWith a creak, the door swings open.'),
        turn('North of House', 0, 'north\nA wall.'),
        turn('West of House', 0, 'south\nA field again.'),
      ],
    });
    r.openrouter.image.mockResolvedValueOnce({ ok: true, value: blob('first') }).mockResolvedValueOnce({ ok: true, value: blob('changed') });
    await r.controller.start();
    await r.controller.idle();
    await r.controller.command('open door');
    await r.controller.idle();
    await r.controller.command('north');
    await r.controller.idle();
    r.ui.showImage.mockClear();
    const callsBefore = r.openrouter.image.mock.calls.length;
    await r.controller.command('south');
    await r.controller.idle();
    expect(r.openrouter.image.mock.calls.length).toBe(callsBefore);
    expect(await (r.ui.showImage.mock.calls[0][0] as Blob).text()).toBe('changed');
    expect(imageKeys(r)).toEqual([
      'zork|cartoon|image|north of house',
      'zork|cartoon|image|west of house',
      'zork|cartoon|image|west of house|m|door-opened',
    ]);
    expect(await r.stored.get('zork|cartoon|image|west of house')!.text()).toBe('first');
  });

  it('a_moment_fires_only_once_per_game', async () => {
    const r = rig({
      scenes: tiny(),
      turns: [turn('West of House', 0, 'West of House'), turn('West of House', 0, 'the door swings open'), turn('West of House', 0, 'the door swings open again')],
    });
    await r.controller.start();
    await r.controller.command('open door');
    await r.controller.command('open door');
    await r.controller.idle();
    expect(r.openrouter.image).toHaveBeenCalledTimes(2);
    expect(r.controller.firedMoments()).toEqual(['door-opened']);
  });

  it('a_moment_in_another_room_does_not_fire', async () => {
    const r = rig({ scenes: tiny(), turns: [turn('North of House', 0, 'North of House'), turn('North of House', 0, 'the door swings open')] });
    await r.controller.start();
    await r.controller.command('x');
    await r.controller.idle();
    expect(r.openrouter.image).toHaveBeenCalledTimes(1);
    expect(r.controller.firedMoments()).toEqual([]);
  });

  it('a_second_moment_in_the_room_adds_its_change_after_the_first', async () => {
    const r = rig({
      scenes: tiny(),
      turns: [turn('West of House', 0, 'West of House'), turn('West of House', 0, 'the door swings open'), turn('West of House', 0, 'a shutter creaks open')],
    });
    await r.controller.start();
    await r.controller.command('a');
    await r.controller.command('b');
    await r.controller.idle();
    const last = r.prompts[r.prompts.length - 1];
    expect(last.indexOf('Change: Same view, but the front door now stands open.')).toBeGreaterThan(0);
    expect(last.indexOf('Change: Same view, but a shutter hangs open.')).toBeGreaterThan(last.indexOf('front door'));
    expect(imageKeys(r)).toContain('zork|cartoon|image|west of house|m|door-opened+shutter-open');
  });

  it('two_moments_in_one_turn_make_one_request', async () => {
    const r = rig({ scenes: tiny(), turns: [turn('West of House', 0, 'West of House'), turn('West of House', 0, 'the door swings open and a shutter creaks open')] });
    await r.controller.start();
    await r.controller.idle();
    await r.controller.command('x');
    await r.controller.idle();
    expect(r.openrouter.image).toHaveBeenCalledTimes(2);
    expect(r.prompts[1]).toContain('front door');
    expect(r.prompts[1]).toContain('shutter');
  });

  it('entering_a_room_and_its_moment_in_the_same_turn_makes_one_request_using_the_change', async () => {
    const r = rig({ scenes: tiny(), turns: [turn('North of House', 0, 'North of House'), turn('West of House', 0, 'West of House\nthe door swings open')] });
    await r.controller.start();
    await r.controller.idle();
    await r.controller.command('go');
    await r.controller.idle();
    expect(r.openrouter.image).toHaveBeenCalledTimes(2);
    expect(r.prompts[1]).toContain('Place: West of House.');
    expect(r.prompts[1]).toContain('Change: Same view, but the front door now stands open.');
  });

  it('the_earlier_picture_of_the_room_goes_along_as_the_reference_image', async () => {
    const r = rig({ scenes: tiny(), turns: [turn('West of House', 0, 'West of House'), turn('West of House', 0, 'the door swings open')] });
    r.openrouter.image.mockResolvedValueOnce({ ok: true, value: blob('first') });
    await r.controller.start();
    await r.controller.idle();
    expect(r.openrouter.image.mock.calls[0][3]).toBeUndefined();
    await r.controller.command('open door');
    await r.controller.idle();
    const reference = r.openrouter.image.mock.calls[1][3] as Blob;
    expect(await reference.text()).toBe('first');
  });

  it('a_moment_whose_room_has_no_stored_picture_goes_out_prompt_only', async () => {
    const r = rig({ scenes: tiny(), turns: [turn('West of House', 0, 'West of House'), turn('West of House', 0, 'the door swings open')] });
    await r.controller.start();
    await r.controller.idle();
    r.stored.clear();
    await r.controller.command('open door');
    await r.controller.idle();
    expect(r.openrouter.image.mock.calls[1][3]).toBeUndefined();
    expect(r.prompts[1]).toContain('Scene: A grassy field');
    expect(r.prompts[1]).toContain('Change: Same view, but the front door now stands open.');
  });

  it('moments_respect_the_key_the_cost_notice_and_the_caps', async () => {
    for (const [settings, why] of [
      [{ key: null }, /key/i],
      [{ consented: false }, /cost/i],
      [{ maxImages: 1 }, /limit/i],
    ] as const) {
      const r = rig({ scenes: tiny(), settings, turns: [turn('West of House', 0, 'West of House'), turn('West of House', 0, 'the door swings open')] });
      await r.controller.start();
      await r.controller.idle();
      const before = r.openrouter.image.mock.calls.length;
      await r.controller.command('open door');
      await r.controller.idle();
      expect(r.openrouter.image.mock.calls.length, JSON.stringify(settings)).toBe(before);
      expect(r.ui.showNotice.mock.calls.some((c) => why.test(c[0])), JSON.stringify(settings)).toBe(true);
    }
  });

  it('a_moment_result_after_the_key_was_forgotten_is_dropped', async () => {
    const r = rig({ scenes: tiny(), turns: [turn('West of House', 0, 'West of House'), turn('West of House', 0, 'the door swings open')] });
    await r.controller.start();
    await r.controller.idle();
    const d = deferred<MediaResult<Blob>>();
    r.openrouter.image.mockReturnValueOnce(d.promise);
    await r.controller.command('open door');
    await vi.waitFor(() => expect(r.openrouter.image).toHaveBeenCalledTimes(2));
    r.settings.key = null;
    d.resolve({ ok: true, value: blob('late') });
    await r.controller.idle();
    expect(imageKeys(r)).toEqual(['zork|cartoon|image|west of house']);
    expect(r.ui.showImage).toHaveBeenCalledTimes(1);
  });

  it('a_failed_moment_picture_keeps_the_old_one_on_screen_and_the_moment_stays_fired', async () => {
    const r = rig({ scenes: tiny(), turns: [turn('West of House', 0, 'West of House'), turn('West of House', 0, 'the door swings open')] });
    await r.controller.start();
    await r.controller.idle();
    r.openrouter.image.mockResolvedValueOnce({ ok: false, reason: 'network' });
    await r.controller.command('open door');
    await r.controller.idle();
    expect(r.ui.showImage).toHaveBeenCalledTimes(1);
    expect(r.ui.showNotice.mock.calls.some((c) => /reach/i.test(c[0]))).toBe(true);
    expect(r.controller.firedMoments()).toEqual(['door-opened']);
    // Redraw asks again, now in the changed state.
    r.controller.retryImage();
    await r.controller.idle();
    expect(r.prompts[r.prompts.length - 1]).toContain('Change: Same view, but the front door now stands open.');
  });

  it('the_player_description_goes_with_a_moment_picture_and_a_new_style_redraws_the_changed_state', async () => {
    const r = rig({
      scenes: tiny(),
      settings: { playerPrompt: 'I am a hiker' },
      turns: [turn('West of House', 0, 'West of House'), turn('West of House', 0, 'the door swings open')],
    });
    await r.controller.start();
    await r.controller.idle();
    await r.controller.command('open door');
    await r.controller.idle();
    expect(r.prompts[1]).toContain('--- Player description ---\nI am a hiker\n');
    r.controller.setStyle('anime');
    await r.controller.idle();
    const last = r.prompts[r.prompts.length - 1];
    expect(last).toContain('Hand-painted anime');
    expect(last).toContain('Change: Same view, but the front door now stands open.');
  });

  it('a_dark_room_entered_without_light_is_drawn_dark_and_the_lamp_moment_replaces_it', async () => {
    const r = rig({
      scenes: tiny(),
      turns: [
        turn('Cave', 0, 'You have moved into a dark place.\nIt is pitch black. You are likely to be eaten by a grue.'),
        turn('Cave', 0, 'turn on lamp\nThe brass lantern is now on.\n\nCave\nA cave.'),
      ],
    });
    await r.controller.start();
    await r.controller.idle();
    expect(r.prompts[0]).toContain('Lighting: the place is in near-total darkness');
    expect(r.prompts[0]).toContain('Scene: A rough stone cave with a low roof.');
    expect(imageKeys(r)).toEqual(['zork|cartoon|image|cave|dark']);
    await r.controller.command('turn on lamp');
    await r.controller.idle();
    expect(r.prompts[1]).not.toContain('Lighting:');
    expect(r.prompts[1]).toContain('Change: Same view, but lit by a warm lantern glow.');
    expect(imageKeys(r)).toEqual(['zork|cartoon|image|cave|dark', 'zork|cartoon|image|cave|m|light-on']);
  });

  it('a_dark_room_entered_with_light_is_drawn_lit', async () => {
    const r = rig({ scenes: tiny(), turns: [turn('Cave', 0, 'Cave\nA small cave with rough walls.')] });
    await r.controller.start();
    await r.controller.idle();
    expect(r.prompts[0]).not.toContain('Lighting:');
    expect(imageKeys(r)).toEqual(['zork|cartoon|image|cave']);
  });

  it('fired_moments_come_back_with_a_restored_game_and_do_not_fire_again', async () => {
    const r = rig({
      scenes: tiny(),
      turns: [turn('West of House', 0, 'banner'), turn('West of House', 0, 'restored'), turn('West of House', 0, 'look\nWest of House\nthe door swings open'), ],
    });
    await r.controller.start(new Uint8Array([1]), ['door-opened', 'not-a-moment']);
    await r.controller.idle();
    expect(r.controller.firedMoments()).toEqual(['door-opened']);
    expect(r.openrouter.image).toHaveBeenCalledTimes(1);
    expect(r.prompts[0]).toContain('Change: Same view, but the front door now stands open.');
    expect(imageKeys(r)).toEqual(['zork|cartoon|image|west of house|m|door-opened']);
  });

  it('the_manual_video_uses_the_room_prompt_as_its_scene', async () => {
    const r = rig({ scenes: tiny(), turns: [turn('West of House', 0, 'West of House\nSome game text.')] });
    await r.controller.start();
    await r.controller.idle();
    await r.controller.requestVideo();
    expect(r.prompts[r.prompts.length - 1]).toContain('Scene: A grassy field before a white house with a boarded door.');
  });

  it('a_moment_while_another_picture_is_in_flight_waits_its_turn_and_still_wins', async () => {
    const r = rig({ scenes: tiny(), turns: [turn('West of House', 0, 'West of House'), turn('West of House', 0, 'the door swings open')] });
    const d = deferred<MediaResult<Blob>>();
    r.openrouter.image.mockReturnValueOnce(d.promise);
    await r.controller.start();
    await vi.waitFor(() => expect(r.openrouter.image).toHaveBeenCalled());
    await r.controller.command('open door');
    d.resolve({ ok: true, value: blob('base') });
    await r.controller.idle();
    expect(r.openrouter.image).toHaveBeenCalledTimes(2);
    expect(r.prompts[r.prompts.length - 1]).toContain('Change:');
    // The base picture was stored but not shown over the changed state; the changed one is the last shown.
    expect(await (r.ui.showImage.mock.calls.at(-1)![0] as Blob).text()).toBe('img');
    expect(r.ui.showImage).toHaveBeenCalledTimes(1);
  });
});

describe('cleanText', () => {
  it('drops_the_echoed_command_line_and_the_trailing_prompt', () => {
    expect(cleanText('open mailbox\nOpening the small mailbox reveals a leaflet.\n\n>', 'open mailbox')).toBe(
      'Opening the small mailbox reveals a leaflet.',
    );
  });
  it('keeps_the_first_line_when_it_is_not_an_echo', () => {
    expect(cleanText('West of House\nYou are here.\n\n>', 'look')).toBe('West of House\nYou are here.');
  });
  it('leaves_empty_text_empty', () => {
    expect(cleanText('', 'x')).toBe('');
    expect(cleanText('\n>', undefined)).toBe('');
  });
});

describe('over the real Zork I', () => {
  it('shows_clean_text_and_asks_for_one_picture_per_new_room', async () => {
    const nodeRequire = createRequire(import.meta.url);
    const path = nodeRequire.resolve('glkote-term/src/glkapi.js');
    delete nodeRequire.cache[path];
    const real = createEngine(new Uint8Array(readFileSync('public/zork1.z3')), nodeRequire(path));
    const r = rig();
    const settings = r.settings;
    const shown: string[] = [];
    const ui = { ...r.ui, showText: (t: string) => void shown.push(t) };
    const c = createController({
      engine: real,
      detector: createDetector(),
      settings,
      guard: createSpendGuard(settings),
      openrouter: r.openrouter,
      store: r.store,
      ui,
      game: 'zork',
    });
    await c.start();
    await c.command('open mailbox');
    await c.command('north');
    await c.idle();
    expect(shown[1]).toBe('Opening the small mailbox reveals a leaflet.');
    expect(shown.every((t) => !t.endsWith('>') && !/^(open mailbox|north)$/m.test(t))).toBe(true);
    // West of House, the mailbox opening (a moment: the same place, changed), and North of House.
    expect(r.openrouter.image).toHaveBeenCalledTimes(3);
    expect(r.prompts[1]).toContain('Place: West of House.');
    expect(r.prompts[1]).toContain('Change: Same view of the field and the white house, but the small mailbox');
    expect(r.prompts[2]).toContain('Place: North of House.');
    expect(c.firedMoments()).toEqual(['mailbox-opened']);
    expect(r.prompts[0]).not.toMatch(/trademark|Infocom/i);
  });
});
