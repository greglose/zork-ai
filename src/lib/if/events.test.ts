import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { createEngine } from './engine';
import { createDetector } from './events';
import type { Turn } from './types';

const nodeRequire = createRequire(import.meta.url);
function freshEngine() {
  const path = nodeRequire.resolve('glkote-term/src/glkapi.js');
  delete nodeRequire.cache[path];
  const story = new Uint8Array(readFileSync('public/zork1.z3'));
  return createEngine(story, nodeRequire(path));
}

const turn = (over: Partial<Turn> = {}): Turn => ({
  text: '',
  status: { location: 'West of House', score: 0, moves: 0 },
  finished: false,
  ...over,
});

describe('createDetector on a recorded Zork transcript', () => {
  it('first_turn_yields_newroom_west_of_house_then_north_of_house_on_moving', async () => {
    const engine = freshEngine();
    const detector = createDetector();
    const first = detector.next(await engine.start());
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ kind: 'newRoom', roomId: 'west of house', roomName: 'West of House' });
    const moved = detector.next(await engine.send('north'));
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ kind: 'newRoom', roomId: 'north of house', roomName: 'North of House' });
    expect(moved[0]!.text).toContain('north side of a white house');
  });

  it('staying_in_the_room_yields_no_event', async () => {
    const engine = freshEngine();
    const detector = createDetector();
    detector.next(await engine.start());
    expect(detector.next(await engine.send('open mailbox'))).toEqual([]);
  });

  it('returning_to_a_seen_room_yields_newroom_again_with_same_roomid', async () => {
    const engine = freshEngine();
    const detector = createDetector();
    const first = detector.next(await engine.start());
    detector.next(await engine.send('north'));
    const back = detector.next(await engine.send('southwest'));
    expect(back[0]).toMatchObject({ kind: 'newRoom', roomId: (first[0] as { roomId: string }).roomId });
  });
});

describe('createDetector on scripted turns', () => {
  it('score_zero_to_ten_yields_scoregain_delta_ten', () => {
    const d = createDetector();
    d.next(turn());
    const events = d.next(turn({ text: 'Taken.', status: { location: 'West of House', score: 10, moves: 1 } }));
    expect(events).toEqual([{ kind: 'scoreGain', delta: 10, text: 'Taken.' }]);
  });

  it('text_containing_you_have_died_yields_death', () => {
    const d = createDetector();
    d.next(turn());
    const events = d.next(turn({ text: '**** You have died ****' }));
    expect(events.map((e) => e.kind)).toEqual(['death']);
  });

  it('text_containing_you_are_dead_yields_death', () => {
    const d = createDetector();
    expect(d.next(turn({ text: 'You are dead!' })).map((e) => e.kind)).toContain('death');
  });

  it('finished_yields_ending', () => {
    const d = createDetector();
    d.next(turn());
    const events = d.next(turn({ text: 'Thanks for playing.', finished: true }));
    expect(events).toEqual([{ kind: 'ending', text: 'Thanks for playing.' }]);
  });

  it('a_turn_with_no_status_yields_no_events', () => {
    const d = createDetector();
    expect(d.next(turn({ text: 'hello', status: null }))).toEqual([]);
  });

  it('score_decrease_yields_no_scoregain', () => {
    const d = createDetector();
    d.next(turn({ status: { location: 'West of House', score: 10, moves: 1 } }));
    expect(d.next(turn({ status: { location: 'West of House', score: 5, moves: 2 } }))).toEqual([]);
  });
});
