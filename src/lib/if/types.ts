export type GameId = 'zork' | 'adventure';

export type Turn = {
  text: string;
  status: { location: string; score: number; moves: number } | null;
  finished: boolean;
};

export type GameEvent =
  | { kind: 'newRoom'; roomId: string; roomName: string; text: string }
  | { kind: 'scoreGain'; delta: number; text: string }
  | { kind: 'death'; text: string }
  | { kind: 'ending'; text: string };
