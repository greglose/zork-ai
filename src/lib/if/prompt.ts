import { BIBLES } from './bible';
import { cleanPlayerPrompt } from './player';
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

// The player's own description of themselves, in its own delimited block. Empty text adds nothing, so a prompt
// without a description is exactly what it was before this block existed.
function playerBlock(playerPrompt: string | undefined, noun: 'image' | 'video'): string[] {
  const text = cleanPlayerPrompt(playerPrompt);
  if (!text) return [];
  return [
    `Player character: follow the description between the markers for the character's appearance. If it asks for a different art look than the style above, let the description take priority. Show the player character in the scene where it fits naturally, for example from behind or at the edge of the frame. No text or captions in the ${noun}.`,
    '--- Player description ---',
    text,
    '--- End of player description ---',
  ];
}

export function buildImagePrompt(i: {
  game: GameId;
  styleId: string;
  roomName: string;
  text: string;
  playerPrompt?: string;
  /** Visible changes since the scene was first drawn, each a "Same view, but ..." line; appended in order. */
  changes?: readonly string[];
  /** The place is unlit: ask for a near-black picture. */
  dark?: boolean;
}): string {
  const prefix = styleOf(i.styleId);
  return [
    prefix,
    BIBLES[i.game],
    ...playerBlock(i.playerPrompt, 'image'),
    `Place: ${ascii(i.roomName)}.`,
    `Scene: ${ascii(i.text).slice(0, MAX_TEXT).trim()}`,
    ...(i.changes ?? []).map((c) => `Change: ${ascii(c).slice(0, MAX_TEXT).trim()}`),
    ...(i.dark ? ['Lighting: the place is in near-total darkness. Show only a very dim suggestion of this view, mostly black.'] : []),
  ].join('\n');
}

const MOMENT: Record<GameEvent['kind'], string> = {
  newRoom: 'A slow camera arrival into the new place.',
  scoreGain: 'A moment of triumph as treasure is found, with a gleam of light.',
  death: 'A dramatic, non-graphic death scene fading to darkness.',
  ending: 'A sweeping ending shot as the adventure concludes.',
};

export function buildVideoPrompt(i: {
  game: GameId;
  styleId: string;
  roomName: string;
  event: GameEvent;
  playerPrompt?: string;
}): string {
  const prefix = styleOf(i.styleId);
  return [
    prefix,
    BIBLES[i.game],
    ...playerBlock(i.playerPrompt, 'video'),
    `Place: ${ascii(i.roomName)}.`,
    `Moment: ${MOMENT[i.event.kind]}`,
    `Scene: ${ascii(i.event.text).slice(0, MAX_TEXT).trim()}`,
  ].join('\n');
}
