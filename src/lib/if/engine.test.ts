import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { createEngine as createEngineWith, type Engine } from './engine';

const story = () => new Uint8Array(readFileSync('public/zork1.z3'));

// glkote-term's Glk API is a module-level singleton (one live game per page load), so each test
// evaluates a pristine copy of it and injects it.
const nodeRequire = createRequire(import.meta.url);
function createEngine(bytes: Uint8Array): Engine {
  const path = nodeRequire.resolve('glkote-term/src/glkapi.js');
  delete nodeRequire.cache[path];
  return createEngineWith(bytes, nodeRequire(path));
}

describe('createEngine over Zork I', () => {
  it('zork_start_text_contains_west_of_house', async () => {
    const turn = await createEngine(story()).start();
    expect(turn.text).toContain('West of House');
    expect(turn.finished).toBe(false);
  });

  it('zork_open_mailbox_text_contains_leaflet', async () => {
    const engine = await createEngine(story());
    await engine.start();
    const turn = await engine.send('open mailbox');
    expect(turn.text).toContain('leaflet');
  });

  it('status_has_location_and_score_zero_at_start', async () => {
    const turn = await createEngine(story()).start();
    expect(turn.status).toEqual({ location: 'West of House', score: 0, moves: 0 });
  });

  it('save_then_restore_returns_same_location', async () => {
    const engine = await createEngine(story());
    await engine.start();
    const atNorth = await engine.send('north');
    expect(atNorth.status?.location).toBe('North of House');
    const data = engine.save();
    expect(data.length).toBeGreaterThan(0);
    const moved = await engine.send('east');
    expect(moved.status?.location).toBe('Behind House');
    const restored = await engine.restore(data);
    expect(restored.status?.location).toBe('North of House');
    expect((await engine.send('look')).text).toContain('North of House');
  });

  it('empty_command_returns_empty_new_text_without_throwing', async () => {
    const engine = await createEngine(story());
    await engine.start();
    const turn = await engine.send('');
    expect(turn.text.trim()).toBe('');
    expect(turn.status?.location).toBe('West of House');
  });
});
