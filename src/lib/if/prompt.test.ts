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
