import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cleanText } from '../src/scripts/controller';
import { MOMENTS, ROOM_SCENES, matchingMoments, momentsIn, roomScene } from '../src/lib/if/scenes';
import { newGame, killTheTroll, objectNames, playAlive } from './play';

type FixtureRoom = { zil: string; desc: string; id: string; lit: boolean };
const fixture = JSON.parse(readFileSync(new URL('./fixtures/zork-rooms.json', import.meta.url), 'utf8')) as {
  source: { repo: string; commit: string };
  rooms: FixtureRoom[];
};
const strings = JSON.parse(readFileSync(new URL('./fixtures/moment-strings.json', import.meta.url), 'utf8')) as {
  composed: string[];
  strings: Record<string, string>;
};
const ids = [...new Set(fixture.rooms.map((r) => r.id))];
const words = (s: string) => s.trim().split(/\s+/).length;

// Words that would fight the art style picked in the page or typed by the player, and words that invite lettering.
const STYLE_WORDS = /\b(cartoon\w*|photo\w*|anime|watercolou?r\w*|pixel\w*|painting\w*|painted|illustrat\w*|sketch\w*|drawing\w*|render\w*|cinematic|manga|comic\w*|oil paint\w*|3d|realistic|hand-drawn|storybook)\b/i;
const LETTER_WORDS = /\b(text|words?|letters?|lettering|inscri\w*|writing|written|caption\w*|labels?|signs?|signage|logo\w*|hieroglyph\w*|runes?)\b/i;

describe('the extracted room list', () => {
  it('comes_from_the_zork1_source_and_has_110_rooms', () => {
    expect(fixture.source.repo).toBe('https://github.com/historicalsource/zork1');
    expect(fixture.source.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(fixture.rooms).toHaveLength(110);
    expect(new Set(fixture.rooms.map((r) => r.zil)).size).toBe(110);
  });

  it('every_room_name_is_printed_by_the_compiled_story_file', () => {
    // The status line prints the short name of the room object, so every DESC must be an object name in the story.
    const names = new Set(objectNames(new Uint8Array(readFileSync(new URL('../public/zork1.z3', import.meta.url)))));
    for (const r of fixture.rooms) expect(names.has(r.desc), r.desc).toBe(true);
  });

  it('the_engine_status_line_matches_the_extracted_id_for_rooms_it_can_reach', async () => {
    const g = await newGame();
    const seen = new Set<string>();
    const note = (t: { status: { location: string } | null }) => {
      if (t.status) seen.add(t.status.location.trim().toLowerCase());
    };
    note(g.first);
    for (const c of ['north', 'north', 'up', 'down', 'north', 'south', 'south', 'south', 'east', 'north', 'east', 'open window', 'west', 'up', 'down', 'west', 'move rug', 'open trap door', 'down']) {
      note(await g.send(c));
    }
    for (const id of ['west of house', 'north of house', 'forest path', 'up a tree', 'clearing', 'behind house', 'kitchen', 'attic', 'living room', 'cellar']) {
      expect(seen.has(id), id).toBe(true);
      expect(ids).toContain(id);
    }
  });

  it('the_status_line_in_the_troll_room_is_the_troll_room', async () => {
    const { game } = await killTheTroll();
    const t = await game.send('look');
    expect(t.status?.location.trim().toLowerCase()).toBe('the troll room');
    expect(ids).toContain('the troll room');
  });
});

describe('room prompts', () => {
  it('there_is_exactly_one_prompt_for_every_room_name_in_the_source', () => {
    expect(ids.length).toBe(78);
    expect(Object.keys(ROOM_SCENES).sort()).toEqual([...ids].sort());
    for (const r of fixture.rooms) expect(roomScene(r.id), r.zil).not.toBeNull();
  });

  it('unknown_rooms_have_no_prompt_and_odd_names_do_not_reach_object_prototype_keys', () => {
    for (const odd of ['', 'nowhere', 'constructor', '__proto__', 'toString']) expect(roomScene(odd)).toBeNull();
  });

  it('every_prompt_is_40_to_80_words_of_plain_ascii', () => {
    for (const [id, s] of Object.entries(ROOM_SCENES)) {
      expect(words(s.prompt), id).toBeGreaterThanOrEqual(40);
      expect(words(s.prompt), id).toBeLessThanOrEqual(80);
      expect(/^[\x20-\x7e]+$/.test(s.prompt), `${id} is ASCII`).toBe(true);
    }
  });

  it('no_prompt_names_an_art_style_or_asks_for_lettering', () => {
    for (const [id, s] of Object.entries(ROOM_SCENES)) {
      expect(s.prompt, id).not.toMatch(STYLE_WORDS);
      expect(s.prompt, id).not.toMatch(LETTER_WORDS);
    }
  });

  it('no_prompt_puts_a_character_or_a_spoiler_in_the_picture', () => {
    const banned = /\b(troll|cyclops|thief|grue|ghost|wraith|skeleton|bat|bats|vampire|egg|chalice|trident|sceptre|scepter|coffin|jewel\w*|treasure\w*|trap door|key|keys)\b/i;
    for (const [id, s] of Object.entries(ROOM_SCENES)) expect(s.prompt, id).not.toMatch(banned);
  });

  it('dark_matches_the_source_flags_exactly', () => {
    for (const id of ids) {
      const lit = fixture.rooms.filter((r) => r.id === id).some((r) => r.lit);
      expect(Boolean(roomScene(id)?.dark), id).toBe(!lit);
    }
    expect(ROOM_SCENES['cellar'].dark).toBe(true);
    expect(ROOM_SCENES['west of house'].dark).toBeUndefined();
  });
});

describe('moment prompts', () => {
  it('there_are_about_forty_with_unique_url_safe_ids', () => {
    expect(MOMENTS.length).toBeGreaterThanOrEqual(38);
    expect(MOMENTS.length).toBeLessThanOrEqual(45);
    expect(new Set(MOMENTS.map((m) => m.id)).size).toBe(MOMENTS.length);
    for (const m of MOMENTS) expect(m.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('each_has_a_known_room_and_a_valid_case_insensitive_regex', () => {
    for (const m of MOMENTS) {
      expect(ROOM_SCENES[m.roomId], m.id).toBeDefined();
      expect(() => new RegExp(m.when, 'i'), m.id).not.toThrow();
      expect(m.when.length, m.id).toBeGreaterThan(5);
    }
  });

  it('each_prompt_describes_the_same_view_with_the_change_in_plain_ascii_without_style_words', () => {
    for (const m of MOMENTS) {
      expect(m.prompt, m.id).toMatch(/^Same /);
      expect(words(m.prompt), m.id).toBeGreaterThanOrEqual(20);
      expect(words(m.prompt), m.id).toBeLessThanOrEqual(70);
      expect(/^[\x20-\x7e]+$/.test(m.prompt), `${m.id} is ASCII`).toBe(true);
      expect(m.prompt, m.id).not.toMatch(STYLE_WORDS);
      expect(m.prompt, m.id).not.toMatch(LETTER_WORDS);
    }
  });

  it('has_a_source_string_for_every_moment_and_no_extras', () => {
    expect(Object.keys(strings.strings).sort()).toEqual(MOMENTS.map((m) => m.id).sort());
  });

  it('every_trigger_matches_the_exact_string_the_game_source_prints_for_it', () => {
    for (const m of MOMENTS) expect(new RegExp(m.when, 'i').test(strings.strings[m.id]), m.id).toBe(true);
  });

  it('a_trigger_does_not_match_the_unrelated_text_of_other_moments_in_its_room', () => {
    for (const m of MOMENTS) {
      for (const other of MOMENTS) {
        if (other.id === m.id || other.roomId !== m.roomId) continue;
        expect(new RegExp(m.when, 'i').test(strings.strings[other.id]), `${m.id} vs ${other.id}`).toBe(false);
      }
    }
  });

  it('matching_moments_looks_in_the_room_ignores_case_and_skips_fired_ones', () => {
    const text = 'WITH A GREAT EFFORT, THE RUG IS MOVED TO ONE SIDE OF THE ROOM, revealing the dusty cover of a closed trap door.';
    expect(matchingMoments('living room', text, new Set()).map((m) => m.id)).toEqual(['rug-moved']);
    expect(matchingMoments('kitchen', text, new Set())).toEqual([]);
    expect(matchingMoments('living room', text, new Set(['rug-moved']))).toEqual([]);
    expect(momentsIn('living room').map((m) => m.id)).toEqual(['rug-moved', 'trap-door-opened']);
  });
});

// ---- Engine-driven proof: the real Zork I prints text that fires the moment, in the room the moment names ----
const fires = (id: string, turn: { text: string; status: { location: string } | null }) => {
  const room = turn.status!.location.trim().toLowerCase();
  const hits = matchingMoments(room, cleanText(turn.text), new Set()).map((m) => m.id);
  expect(hits, `${id} in ${room}: ${JSON.stringify(turn.text)}`).toContain(id);
};
const play = async (commands: string[]) => (await playAlive(commands)).at(-1)!;
const INTO_HOUSE = ['north', 'east', 'open window', 'west', 'west'];

describe('moments proven against the real engine', () => {
  it('mailbox-opened', async () => fires('mailbox-opened', await play(['open mailbox'])));
  it('window-opened', async () => fires('window-opened', await play(['north', 'east', 'open window'])));
  it('leaves-grating-revealed', async () => fires('leaves-grating-revealed', await play(['north', 'north', 'north', 'move leaves'])));
  it('rug-moved', async () => fires('rug-moved', await play([...INTO_HOUSE, 'move rug'])));
  it('trap-door-opened', async () => fires('trap-door-opened', await play([...INTO_HOUSE, 'move rug', 'open trap door'])));
  it('lamp-lit-cellar', async () => fires('lamp-lit-cellar', await play([...INTO_HOUSE, 'take lamp', 'move rug', 'open trap door', 'down', 'turn on lamp'])));
  it('the lamp text in the cellar fires only the cellar moment', async () => {
    const t = await play([...INTO_HOUSE, 'take lamp', 'move rug', 'open trap door', 'down', 'turn on lamp']);
    expect(matchingMoments('cellar', cleanText(t.text), new Set()).map((m) => m.id)).toEqual(['lamp-lit-cellar']);
  });
  it('troll-killed', async () => {
    const { game, kill } = await killTheTroll();
    expect(kill.status?.location.trim().toLowerCase()).toBe('the troll room');
    fires('troll-killed', kill);
    expect(game).toBeDefined();
  });
  it('lamp-lit-troll-room', async () => {
    // Walk into the troll room with the lamp off (a dark room), then light it there.
    const turns = await playAlive([...INTO_HOUSE, 'take lamp', 'move rug', 'open trap door', 'down', 'turn on lamp', 'turn off lamp', 'north', 'turn on lamp']);
    expect(turns.at(-2)!.text).toMatch(/pitch black/i);
    fires('lamp-lit-troll-room', turns.at(-1)!);
  });
  it('mirror-broken and cyclops-flees after the troll is dead', async () => {
    const { game } = await killTheTroll();
    await game.run(['east', 'east', 'south', 'south']);
    const broke = await game.send('break mirror with sword');
    fires('mirror-broken', broke);
    await game.run(['north', 'north', 'west', 'west']);
    const walk = await game.run(['west', 'south', 'east', 'up', 'sw', 'east', 'south', 'se']);
    expect(walk.at(-1)!.status?.location).toBe('Cyclops Room');
    fires('cyclops-flees', await game.send('odysseus'));
  }, 30_000);
  it('dam gates open, close, and the reservoir drains', async () => {
    const { game } = await killTheTroll();
    await game.run(['east', 'down', 'ne', 'east']);
    expect((await game.send('look')).status?.location).toBe('Dam');
    await game.run(['north', 'north', 'take wrench']);
    await game.send('push yellow button');
    await game.run(['south', 'south']);
    fires('dam-gates-open', await game.send('turn bolt with wrench'));
    const waits = await game.run(Array(10).fill('wait'));
    expect(waits.length).toBe(10);
    fires('reservoir-south-drained', await game.send('west'));
    fires('dam-gates-closed', await game.run(['east', 'turn bolt with wrench']).then((t) => t.at(-1)!));
  }, 30_000);
});
