// Lists every <ROOM ...> in Zork I's 1dungeon.zil with its DESC string, the lowercased id the status line gives
// the page, and whether the room has the ONBIT flag (lit without a lamp).
//   git clone https://github.com/historicalsource/zork1 /tmp/zork1-src
//   node scripts/extract-zork-rooms.mjs /tmp/zork1-src/1dungeon.zil > tests/fixtures/zork-rooms.json
// tests/fixtures/zork-rooms.json is that output; tests/scenes.test.ts checks every room has a prompt.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/extract-zork-rooms.mjs path/to/1dungeon.zil');
  process.exit(2);
}
const text = readFileSync(file, 'latin1');
const rooms = [];
for (const block of text.split(/\n(?=<ROOM |<OBJECT )/)) {
  const zil = /^<ROOM\s+([A-Z0-9-]+)/.exec(block)?.[1];
  if (!zil) continue;
  const desc = /\(DESC "([^"]*)"\)/.exec(block)?.[1];
  if (desc === undefined) throw new Error(`${zil} has no DESC`);
  // ;"..." is a ZIL comment (the treasure room has one that mentions ONBIT); it is not a flag.
  const flags = (/\(FLAGS([^)]*)\)/.exec(block)?.[1] ?? '').replace(/;"[^"]*"/g, '');
  rooms.push({ zil, desc, id: desc.trim().toLowerCase(), lit: /\bONBIT\b/.test(flags) });
}
let commit = 'unknown';
try {
  commit = execFileSync('git', ['-C', dirname(file), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
} catch {
  // Not a git checkout: leave the commit unknown.
}
console.log(JSON.stringify({ source: { repo: 'https://github.com/historicalsource/zork1', commit, file: '1dungeon.zil' }, rooms }, null, 2));
