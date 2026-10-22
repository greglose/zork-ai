import { describe, expect, it } from 'vitest';
import { createSpendGuard, defaultSettings, parseSettings } from './settings';

const ready = () => ({ ...defaultSettings(), key: 'sk-or-test', consented: true });

describe('settings', () => {
  it('parse_bad_json_gives_defaults', () => {
    for (const bad of [null, undefined, 42, 'x', [], { key: 5, maxImages: 'a', consented: 'yes' }]) {
      expect(parseSettings(bad)).toEqual(defaultSettings());
    }
  });
  it('parse_drops_unknown_style', () => {
    const s = parseSettings({ styleByGame: { zork: 'anime', adventure: 'bogus', other: 'pixel' } });
    expect(s.styleByGame).toEqual({ zork: 'anime' });
  });
  it('guard_blocks_image_at_cap', () => {
    const g = createSpendGuard({ ...ready(), maxImages: 2, maxVideos: 1 });
    expect(g.canImage()).toBe(true);
    g.noteImage();
    g.noteImage();
    expect(g.canImage()).toBe(false);
    expect(g.canVideo()).toBe(true);
    g.noteVideo();
    expect(g.canVideo()).toBe(false);
  });
  it('guard_blocks_when_not_consented', () => {
    const g = createSpendGuard({ ...ready(), consented: false });
    expect(g.canImage()).toBe(false);
    expect(g.canVideo()).toBe(false);
  });
  it('guard_blocks_when_no_key', () => {
    const g = createSpendGuard({ ...ready(), key: null });
    expect(g.canImage()).toBe(false);
    expect(g.canVideo()).toBe(false);
  });
  it('reset_clears_counts', () => {
    const g = createSpendGuard({ ...ready(), maxImages: 1, maxVideos: 1 });
    g.noteImage();
    g.noteVideo();
    g.reset();
    expect(g.canImage()).toBe(true);
    expect(g.canVideo()).toBe(true);
  });
});

describe('playerPrompt setting', () => {
  it('defaults_to_empty', () => {
    expect(defaultSettings().playerPrompt).toBe('');
  });
  it('is_kept_cleaned_and_capped_on_parse', () => {
    expect(parseSettings({ playerPrompt: '  I am a\nhiker \u00e9\u0000 ' }).playerPrompt).toBe('I am a hiker \u00e9');
    expect(parseSettings({ playerPrompt: 'x'.repeat(2000) }).playerPrompt).toHaveLength(500);
  });
  it('is_replaced_with_empty_when_not_a_string', () => {
    for (const bad of [5, null, {}, ['a'], true]) expect(parseSettings({ playerPrompt: bad }).playerPrompt).toBe('');
  });
});
