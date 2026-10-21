import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import config from '../astro.config.mjs';

const ROOT = join(__dirname, '..');

// engine.ts is unit-tested under Node, where glkote-term (old sloppy-mode script code that assigns an
// undeclared global `Glk = function(){...}()`) loads as plain CJS and works. The browser gets it bundled
// into a strict ES module, where that assignment throws "Glk is not defined". So bundle the engine with the
// site's own Vite plugins and run it as a real ES module in a clean Node process: no mocks, no sloppy CJS.
describe('Zork engine, bundled like the page', () => {
  it('runs the first turn from the real story file as a strict ES module', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'if-engine-bundle-'));
    await build({
      configFile: false,
      root: ROOT,
      logLevel: 'silent',
      plugins: config.vite?.plugins ?? [],
      build: {
        write: true,
        outDir: dir,
        emptyOutDir: false,
        minify: false,
        target: 'es2022',
        lib: { entry: join(ROOT, 'src/lib/if/engine.ts'), formats: ['es'], fileName: 'engine' },
      },
    });
    const story = join(ROOT, 'public/zork1.z3');
    writeFileSync(
      join(dir, 'run.mjs'),
      `import { readFileSync } from 'node:fs';
import { createEngine } from './engine.js';
const engine = createEngine(new Uint8Array(readFileSync(${JSON.stringify(story)})));
const first = await engine.start();
const second = await engine.send('open mailbox');
console.log(JSON.stringify({ first, second }));`,
    );
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    expect(readFileSync(join(dir, 'engine.js'), 'utf8')).toContain('createEngine');
    const out = execFileSync(process.execPath, [join(dir, 'run.mjs')], { encoding: 'utf8', cwd: dir });
    const { first, second } = JSON.parse(out.trim().split('\n').pop()!);
    expect(first.text).toContain('West of House');
    expect(second.text).toContain('leaflet');
  }, 60_000);
});
