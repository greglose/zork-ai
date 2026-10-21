import type { GameEvent, Turn } from './types';

const DEATH = /you have died|you are dead/i;

// Generic, game-agnostic event detection from the status line and turn text. Pure and stateful
// only in the last-seen room/score; no DOM, clock or randomness.
export function createDetector(): { next(turn: Turn): GameEvent[] } {
  let lastRoomId: string | null = null;
  let lastScore: number | null = null;

  return {
    next(turn) {
      const events: GameEvent[] = [];
      const { status, text } = turn;
      if (status) {
        const roomId = status.location.trim().toLowerCase();
        if (roomId && roomId !== lastRoomId) {
          events.push({ kind: 'newRoom', roomId, roomName: status.location.trim(), text });
        }
        if (roomId) lastRoomId = roomId;
        if (lastScore !== null && status.score > lastScore) {
          events.push({ kind: 'scoreGain', delta: status.score - lastScore, text });
        }
        lastScore = status.score;
      }
      if (DEATH.test(text)) events.push({ kind: 'death', text });
      if (turn.finished) events.push({ kind: 'ending', text });
      return events;
    },
  };
}
