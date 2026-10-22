import { describe, expect, it } from 'vitest';
import { PLAYER_PROMPT_MAX, cleanPlayerPrompt, mediaNamespace } from './player';

describe('cleanPlayerPrompt', () => {
  it('non_strings_give_empty', () => {
    for (const v of [undefined, null, 5, {}, [], true]) expect(cleanPlayerPrompt(v)).toBe('');
  });
  it('trims_and_collapses_whitespace_including_newlines_and_tabs', () => {
    expect(cleanPlayerPrompt('  I am a\n\n hiker\t in  boots \r\n')).toBe('I am a hiker in boots');
  });
  it('removes_control_and_bidi_characters', () => {
    expect(cleanPlayerPrompt('a\u0000b\u0007c\u007fd\u0085e\u200bf\u202eg\u2066h')).toBe('abcdefgh');
  });
  it('keeps_non_ascii_text_the_player_typed', () => {
    expect(cleanPlayerPrompt('Soy una exploradora \u00e1gil \u2014 \u65e5\u672c\u8a9e \ud83e\udd7e')).toBe(
      'Soy una exploradora \u00e1gil \u2014 \u65e5\u672c\u8a9e \ud83e\udd7e',
    );
  });
  it('caps_at_500_characters_without_splitting_a_surrogate_pair', () => {
    expect(PLAYER_PROMPT_MAX).toBe(500);
    expect(cleanPlayerPrompt('a'.repeat(900))).toHaveLength(500);
    const out = cleanPlayerPrompt('\ud83e\udd7e'.repeat(400));
    expect([...out]).toHaveLength(400);
    const edge = cleanPlayerPrompt('a'.repeat(499) + '\ud83e\udd7e');
    expect(edge).toBe('a'.repeat(499) + '\ud83e\udd7e');
    expect(() => encodeURIComponent(edge)).not.toThrow();
  });
});

describe('mediaNamespace', () => {
  it('is_just_the_style_when_the_description_is_empty_so_old_pictures_are_still_found', () => {
    expect(mediaNamespace('cartoon', '')).toBe('cartoon');
  });
  it('is_deterministic_and_short', () => {
    const a = mediaNamespace('anime', 'I am a hiker');
    expect(a).toBe(mediaNamespace('anime', 'I am a hiker'));
    expect(a).toMatch(/^anime\.[0-9a-z]{6,12}$/);
  });
  it('changes_when_style_or_description_changes', () => {
    const seen = new Set([
      mediaNamespace('cartoon', ''),
      mediaNamespace('anime', ''),
      mediaNamespace('cartoon', 'I am a hiker'),
      mediaNamespace('anime', 'I am a hiker'),
      mediaNamespace('cartoon', 'I am a hiker.'),
    ]);
    expect(seen.size).toBe(5);
  });
  it('ignores_whitespace_differences_only', () => {
    expect(mediaNamespace('cartoon', ' I am   a hiker\n')).toBe(mediaNamespace('cartoon', 'I am a hiker'));
  });
  it('never_contains_the_pipe_used_between_key_parts', () => {
    expect(mediaNamespace('cartoon', 'a|b|c')).not.toContain('|');
  });
});
