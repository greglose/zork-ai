import { BIBLES } from './bible';
import { STYLES } from './styles';
import type { GameEvent, GameId } from './types';

const MAX_TEXT = 600;

function ascii(s: string): string {
  return s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[^\x20-\x7e]/g, '')
    .trim();
}

function styleOf(id: string): string {
  const s = STYLES.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown style: ${id}`);
  return s.prefix;
}

export function buildImagePrompt(i: { game: GameId; styleId: string; roomName: string; text: string }): string {
  const prefix = styleOf(i.styleId);
  return [prefix, BIBLES[i.game], `Place: ${ascii(i.roomName)}.`, `Scene: ${ascii(i.text).slice(0, MAX_TEXT).trim()}`].join('\n');
}

const MOMENT: Record<GameEvent['kind'], string> = {
  newRoom: 'A slow camera arrival into the new place.',
  scoreGain: 'A moment of triumph as treasure is found, with a gleam of light.',
  death: 'A dramatic, non-graphic death scene fading to darkness.',
  ending: 'A sweeping ending shot as the adventure concludes.',
};

export function buildVideoPrompt(i: { game: GameId; styleId: string; roomName: string; event: GameEvent }): string {
  const prefix = styleOf(i.styleId);
  return [
    prefix,
    BIBLES[i.game],
    `Place: ${ascii(i.roomName)}.`,
    `Moment: ${MOMENT[i.event.kind]}`,
    `Scene: ${ascii(i.event.text).slice(0, MAX_TEXT).trim()}`,
  ].join('\n');
}
