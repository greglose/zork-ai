import { describe, expect, it } from 'vitest';
import { STYLES } from './styles';
import { BIBLES } from './bible';
import { buildImagePrompt, buildVideoPrompt } from './prompt';

const base = { game: 'zork' as const, styleId: 'cartoon', roomName: 'West of House', text: 'You are standing in an open field.' };

describe('prompt builder', () => {
  it('image_prompt_starts_with_style_prefix', () => {
    const s = STYLES.find((x) => x.id === 'cartoon')!;
    expect(buildImagePrompt(base).startsWith(s.prefix)).toBe(true);
  });
  it('image_prompt_contains_bible', () => {
    expect(buildImagePrompt(base)).toContain(BIBLES.zork);
    expect(buildImagePrompt({ ...base, game: 'adventure' })).toContain(BIBLES.adventure);
  });
  it('room_text_capped_at_600_chars', () => {
    const p = buildImagePrompt({ ...base, text: 'a'.repeat(5000) });
    expect(p).toContain('a'.repeat(600));
    expect(p).not.toContain('a'.repeat(601));
  });
  it('output_is_ascii_only', () => {
    const p = buildImagePrompt({ ...base, roomName: 'Caf\u00e9', text: 'Na\u00efve \u201cquote\u201d \u2014 done' });
    expect(/^[\x20-\x7e\n]*$/.test(p)).toBe(true);
    const v = buildVideoPrompt({ game: 'zork', styleId: 'anime', roomName: 'Caf\u00e9', event: { kind: 'death', text: 'Oh \u2014 no' } });
    expect(/^[\x20-\x7e\n]*$/.test(v)).toBe(true);
  });
  it('unknown_style_throws', () => {
    expect(() => buildImagePrompt({ ...base, styleId: 'nope' })).toThrow();
    expect(() => buildVideoPrompt({ game: 'zork', styleId: 'nope', roomName: 'x', event: { kind: 'ending', text: 'y' } })).toThrow();
  });
  it('prompt_is_deterministic', () => {
    expect(buildImagePrompt(base)).toBe(buildImagePrompt({ ...base }));
  });
  it('video_prompt_mentions_event_kind', () => {
    const kinds = [
      { kind: 'newRoom', roomId: 'r', roomName: 'Attic', text: 't' },
      { kind: 'scoreGain', delta: 5, text: 't' },
      { kind: 'death', text: 't' },
      { kind: 'ending', text: 't' },
    ] as const;
    const words = ['arrival', 'treasure', 'death', 'ending'];
    kinds.forEach((event, i) => {
      const v = buildVideoPrompt({ game: 'adventure', styleId: 'pixel', roomName: 'Attic', event });
      expect(v.toLowerCase()).toContain(words[i]);
    });
  });
});

describe('player description in prompts', () => {
  const me = 'I am a woman adventurer dressed for a day of hiking. I wish to explore a colorful cartoon version of this game.';
  const video = { game: 'zork' as const, styleId: 'cartoon', roomName: 'West of House', event: { kind: 'death' as const, text: 't' } };

  it('is_byte_identical_when_missing_empty_or_blank', () => {
    const plain = buildImagePrompt(base);
    expect(buildImagePrompt({ ...base, playerPrompt: '' })).toBe(plain);
    expect(buildImagePrompt({ ...base, playerPrompt: '  \n ' })).toBe(plain);
    const plainVideo = buildVideoPrompt(video);
    expect(buildVideoPrompt({ ...video, playerPrompt: '' })).toBe(plainVideo);
    expect(buildVideoPrompt({ ...video, playerPrompt: '   ' })).toBe(plainVideo);
  });
  it('adds_a_delimited_block_after_style_and_bible_and_before_the_place', () => {
    const p = buildImagePrompt({ ...base, playerPrompt: me });
    const style = STYLES.find((x) => x.id === 'cartoon')!.prefix;
    const at = (s: string) => p.indexOf(s);
    expect(at(style)).toBe(0);
    expect(at(BIBLES.zork)).toBeGreaterThan(at(style));
    expect(at(me)).toBeGreaterThan(at(BIBLES.zork));
    expect(at('Place: West of House.')).toBeGreaterThan(at(me));
    expect(p).toMatch(/-{3} Player description -{3}\n[^\n]*hiking[^\n]*\n-{3} End of player description -{3}/);
  });
  it('tells_the_model_how_to_use_it', () => {
    const p = buildImagePrompt({ ...base, playerPrompt: me });
    expect(p).toMatch(/follow the description[^\n]*appearance/i);
    expect(p).toMatch(/different art look[^\n]*priority/i);
    expect(p).toMatch(/from behind or at the edge of the frame/i);
    expect(p).toMatch(/no text or captions/i);
  });
  it('is_in_video_prompts_too', () => {
    const v = buildVideoPrompt({ ...video, playerPrompt: me });
    expect(v).toContain(me);
    expect(v.indexOf(me)).toBeLessThan(v.indexOf('Moment:'));
    expect(v).toMatch(/no text or captions/i);
  });
  it('keeps_non_ascii_player_text_but_the_rest_stays_ascii', () => {
    const p = buildImagePrompt({ ...base, playerPrompt: 'Soy \u00e1gil' });
    expect(p).toContain('Soy \u00e1gil');
    expect(p.replace('Soy \u00e1gil', '')).toMatch(/^[\x20-\x7e\n]*$/);
  });
  it('is_cleaned_and_capped_even_when_given_raw', () => {
    const p = buildImagePrompt({ ...base, playerPrompt: 'x'.repeat(900) + '\u0000' });
    expect(p).toContain('x'.repeat(500));
    expect(p).not.toContain('x'.repeat(501));
  });
});
