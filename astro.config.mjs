// @ts-check
import { defineConfig } from 'astro/config';

// Where the site is served. Defaults match the GitHub Pages project site; override for another host or a custom
// domain (ZORK_BASE=/ for a domain root). Every asset URL, the web manifest and the service worker scope follow
// the base, so nothing else needs editing.
const SITE = process.env.ZORK_SITE || 'https://greglose.github.io';
const BASE = `/${(process.env.ZORK_BASE ?? '/zork-ai/').replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/');

// glkote-term's glkapi.js is old sloppy-mode script code that assigns undeclared globals (`Glk = function ()
// {...}()`, plus loop/temp variables such as `split` and `lx`). Node loads it as plain CJS, where that works;
// the browser bundle is a strict ES module, where the first such assignment throws "Glk is not defined" and
// the page never starts. Declaring them as vars of the module scope keeps the exact sharing semantics
// (they were one shared global each) without touching node_modules. The list comes from a TS2304 scan of the
// file; tests/engine-bundle.test.ts runs the bundle strictly and fails if a new one appears.
const GLKAPI_IMPLICIT_GLOBALS = ['Glk', 'ch', 'content_box', 'fref', 'ix', 'lineobj', 'lx', 'split'];
const glkapiStrictFix = {
  name: 'glkapi-declare-implicit-globals',
  enforce: /** @type {const} */ ('pre'),
  /** @param {string} code @param {string} id */
  transform(code, id) {
    if (!/glkote-term[\\/]src[\\/]glkapi\.js$/.test(id)) return null;
    return { code: `var ${GLKAPI_IMPLICIT_GLOBALS.join(', ')};\n${code}`, map: null };
  },
};

// https://astro.build/config
export default defineConfig({
  site: SITE,
  base: BASE,
  trailingSlash: 'always',
  vite: { plugins: [glkapiStrictFix] },
});
