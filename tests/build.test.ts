import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { BASE, html, read, scriptClosure } from './helpers';

const PAGE = 'index.html';
const ROOT = join(__dirname, '..');
const rel = (url: string) => url.slice(BASE.length);

describe('page build', () => {
  it('ships the story file next to the page, for the offline worker to cache', () => {
    expect(existsSync(join(ROOT, 'dist', 'zork1.z3'))).toBe(true);
  });
  it('caps the gzipped page script at 80 KB', () => {
    const files = scriptClosure(PAGE);
    expect(files.length).toBeGreaterThan(0);
    const gz = files.reduce((n, f) => n + gzipSync(readFileSync(join(ROOT, 'dist', rel(f)))).length, 0);
    expect(gz).toBeLessThan(80 * 1024);
  });
  it('loads no script from another origin, OpenRouter least of all', () => {
    const $ = html(PAGE);
    const srcs = $('script[src]').map((_, el) => $(el).attr('src') ?? '').get();
    expect(srcs.length).toBeGreaterThan(0);
    for (const src of srcs) expect(src).not.toMatch(/^(https?:)?\/\//);
    expect(read(PAGE)).not.toMatch(/<script[^>]*openrouter/i);
    expect(read(PAGE)).not.toMatch(/<link[^>]*href="https?:\/\/openrouter/i);
  });
  it('names openrouter.ai only in the client bundle and the page text, never in a tag attribute', () => {
    const $ = html(PAGE);
    const attrs = $('*').toArray().flatMap((el) => Object.values((el as { attribs?: Record<string, string> }).attribs ?? {}));
    expect(attrs.filter((v) => /openrouter\.ai/i.test(v))).toEqual([]);
    const closure = scriptClosure(PAGE).map((p) => read(rel(p))).join('\n');
    expect(closure).toContain('https://openrouter.ai/api/v1');
  });
  it('never puts a key or a player command into a URL', () => {
    const closure = scriptClosure(PAGE).map((p) => read(rel(p))).join('\n');
    expect(closure).not.toMatch(/openrouter\.ai[^"'`]*\?[^"'`]*(key|api_key|prompt)=/i);
  });
  it('uses no analytics and no third-party origin in the page', () => {
    const $ = html(PAGE);
    const urls = $('[src],[href]').map((_, el) => $(el).attr('src') ?? $(el).attr('href') ?? '').get();
    const external = urls.filter((u) => /^https?:\/\//.test(u));
    expect(external).toEqual(['https://cantlosesoftware.com']);
  });
});

describe('base path', () => {
  it('prefixes every local asset URL with the base', () => {
    const $ = html(PAGE);
    const urls = $('[src],[href]').map((_, el) => $(el).attr('src') ?? $(el).attr('href') ?? '').get();
    const local = urls.filter((u) => !/^(https?:|#|mailto:)/.test(u));
    expect(local.length).toBeGreaterThan(0);
    for (const u of local) expect(u.startsWith(BASE)).toBe(true);
  });
  it('serves a manifest whose start_url and scope follow the base', () => {
    const m = JSON.parse(read('manifest.webmanifest'));
    expect(m.start_url).toBe(BASE);
    expect(m.scope).toBe(BASE);
    expect(m.display).toBe('standalone');
    for (const icon of m.icons) {
      expect(icon.src.startsWith(BASE)).toBe(true);
      expect(existsSync(join(ROOT, 'dist', rel(icon.src)))).toBe(true);
    }
    expect(html(PAGE)('link[rel="manifest"]').attr('href')).toBe(`${BASE}manifest.webmanifest`);
  });
  it('ships the service worker at the base', () => {
    expect(existsSync(join(ROOT, 'dist', 'sw.js'))).toBe(true);
  });
});

describe('page text', () => {
  const text = () => html(PAGE)('body').text().replace(/\s+/g, ' ');
  it('says the description of each place and the art style go to OpenRouter and the model provider, commands do not', () => {
    expect(text()).toMatch(/description of each place[^.]*art style[^.]*OpenRouter[^.]*provider/i);
    expect(text()).toMatch(/commands are not/i);
  });
  it("says the key is the player's own and stays in the browser", () => {
    expect(text()).toMatch(/your own OpenRouter/i);
    expect(text()).toMatch(/Kept in this browser only and sent to openrouter\.ai alone/);
  });
  it('credits the story file and carries the only footer link', () => {
    expect(text()).toMatch(/Infocom's Zork I, released by Microsoft under the MIT license/);
    const link = html(PAGE)('footer a[href="https://cantlosesoftware.com"]');
    expect(link.length).toBe(1);
    expect(html(PAGE)('footer').text()).toContain('A Cant Lose Software project');
  });
  it('is plain ASCII', () => {
    expect(/[^\x00-\x7f]/.test(read(PAGE))).toBe(false);
  });
});
