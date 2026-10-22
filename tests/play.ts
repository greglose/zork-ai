// Plays the real compiled Zork I through the real engine, for specs that must prove what the game prints.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createEngine } from '../src/lib/if/engine';
import type { Turn } from '../src/lib/if/types';

const nodeRequire = createRequire(import.meta.url);
const story = new Uint8Array(readFileSync(new URL('../public/zork1.z3', import.meta.url)));

/** A fresh game. glkote-term's Glk layer is a module singleton, so each game gets a pristine copy of it. */
export async function newGame() {
  const path = nodeRequire.resolve('glkote-term/src/glkapi.js');
  delete nodeRequire.cache[path];
  const engine = createEngine(story.slice(), nodeRequire(path)); // the VM writes into the bytes it is given
  const first = await engine.start();
  return {
    first,
    send: (command: string): Promise<Turn> => engine.send(command),
    /** Sends each command in turn and returns every turn. */
    async run(commands: string[]): Promise<Turn[]> {
      const turns: Turn[] = [];
      for (const c of commands) turns.push(await engine.send(c));
      return turns;
    },
  };
}

export type Game = Awaited<ReturnType<typeof newGame>>;

/** Into the house by the window, lamp lit and sword in hand, down to the cellar and into the troll room. */
export const TO_TROLL_ROOM = [
  'north', 'east', 'open window', 'west', 'west', 'take lamp', 'take sword', 'turn on lamp', 'move rug', 'open trap door', 'down', 'north',
];

/**
 * Plays the commands in fresh games until one gets through without the player dying. Waiting in the dark risks a
 * grue (random), so scenes that need a dark room are retried instead of being flaky. Returns every turn.
 */
export async function playAlive(commands: string[], attempts = 60): Promise<Turn[]> {
  for (let i = 0; i < attempts; i++) {
    const game = await newGame();
    const turns = await game.run(commands);
    if (!turns.some((t) => /You have died|You are dead/i.test(t.text))) return turns;
  }
  throw new Error(`the player kept dying: ${commands.join(', ')}`);
}

/**
 * The troll fight is random (the sword can be knocked away, the player can die), so this plays fresh games until
 * one ends with the troll dead. Returns that game, standing in the troll room, and the turn that killed the troll.
 */
export async function killTheTroll(): Promise<{ game: Game; kill: Turn }> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const game = await newGame();
    await game.run(TO_TROLL_ROOM);
    for (let blow = 0; blow < 30; blow++) {
      const turn = await game.send('attack troll with sword');
      if (/breathes his last breath/.test(turn.text)) return { game, kill: turn };
      if (/You have died|You are dead/i.test(turn.text)) break;
      if (/don't have the sword/.test(turn.text)) await game.send('take sword');
    }
  }
  throw new Error('the troll never died in 60 games');
}

/** The short names of every object in a version 3 story file (a room's name is its object name). */
export function objectNames(story: Uint8Array): string[] {
  const word = (at: number) => (story[at] << 8) | story[at + 1];
  const A2 = ' \n0123456789.,!?_#\'"/\\-:()';
  const abbrevBase = word(0x18);
  const zstring = (at: number, depth = 0): string => {
    let out = '';
    let alphabet = 0;
    let pending = 0;
    for (let a = at; ; a += 2) {
      const w = word(a);
      for (const z of [(w >> 10) & 31, (w >> 5) & 31, w & 31]) {
        if (pending) {
          if (depth < 2) out += zstring(word(abbrevBase + 2 * (32 * (pending - 1) + z)) * 2, depth + 1);
          pending = 0;
        } else if (z >= 1 && z <= 3) pending = z;
        else if (z === 4) alphabet = 1;
        else if (z === 5) alphabet = 2;
        else {
          if (z === 0) out += ' ';
          else if (alphabet === 2 && z === 6) out += '?';
          else if (alphabet === 2) out += A2[z - 6] ?? '';
          else out += String.fromCharCode((alphabet === 1 ? 65 : 97) + z - 6);
          alphabet = 0;
        }
      }
      if (w & 0x8000) return out;
    }
  };
  const table = word(0x0a) + 31 * 2;
  const names: string[] = [];
  let firstProps = Infinity;
  for (let at = table; at < firstProps; at += 9) {
    const props = word(at + 7);
    firstProps = Math.min(firstProps, props);
    names.push(zstring(props + 1));
  }
  return names;
}
