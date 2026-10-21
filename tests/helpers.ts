import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as cheerio from 'cheerio';

export const DIST = join(__dirname, '..', 'dist');
export const BASE = '/zork-ai/';

export const exists = (path: string) => existsSync(join(DIST, path));
export const read = (path: string) => readFileSync(join(DIST, path), 'utf-8');
export const html = (path: string) => cheerio.load(read(path));

/** Every built JS file the page loads, as base-rooted URLs: script tags, modulepreloads and the imports between them. */
export function scriptClosure(page: string): string[] {
  const $ = html(page);
  const inline = $('script:not([src])').map((_, el) => $(el).text()).get().join('\n');
  const prefix = `${BASE}_astro/`;
  const start = [
    ...$('script[src]').map((_, el) => $(el).attr('src') ?? '').get(),
    ...$('link[rel="modulepreload"]').map((_, el) => $(el).attr('href') ?? '').get(),
    ...[...inline.matchAll(/["'](\/zork-ai\/_astro\/[^"']+\.js)["']/g)].map((m) => m[1]),
  ].filter((s) => s.startsWith(prefix));
  const seen = new Set<string>();
  const todo = [...start];
  while (todo.length) {
    const path = todo.pop()!;
    const rel = path.slice(BASE.length);
    if (seen.has(path) || !exists(rel)) continue;
    seen.add(path);
    for (const m of read(rel).matchAll(/["'](?:\.\/|\/zork-ai\/_astro\/)([^"'/]+\.js)["']/g)) todo.push(`${prefix}${m[1]}`);
  }
  return [...seen];
}
