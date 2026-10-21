> Historical copy from the Cant Lose Software site, where this feature was designed. File paths, the `/games/` section, the CLS site rules and the `cls.*` storage keys refer to that site. In this repo the code lives under `src/lib/if/` and `src/scripts/`, the page is `src/pages/index.astro`, and the story file is `public/zork1.z3`.

# Illustrated Adventures - design

Date: 2026-10-20. Status: draft for approval. Site: cantlosesoftware.com (Astro static, Cloudflare Pages).

## Intent

Two classic text adventures, the Infocom Zork I and the original Colossal Cave Adventure, playable as PWAs in the existing `/games/` section. The player brings their own OpenRouter API key. The game generates an AI picture for each place the player visits, and short AI video for key moments. The player picks an art style (cartoon, photo, anime, and so on) and the look stays consistent for the whole game.

Why: the text games are loved but hard to get into for new players; pictures make the world concrete without changing the game. Costs fall on the player's own key, so the site runs no backend.

## Goals

- Real game logic: run the genuine game files in a JS Z-machine interpreter. No rewrite of either game.
- A picture on entering each new room, cached so revisits are free.
- Video at key moments: score gains, treasure pickups, deaths, the ending. Also on demand: a "Make a video" button the player can press any time.
- Style picker (cartoon, photo, anime, plus more at the builder's discretion, a "custom" free-text style is a stretch). Chosen once per game save; each style is a fixed prompt prefix, and each game has a short "bible" (a few lines on how its key places and objects look) reused in every request for consistency.
- Offline: the text game, saves, and already-generated pictures and videos work offline. Generating new media needs network.
- Fits the site: pages in `GameShell`, registry entries, shared service worker and register module, tokens, tests, privacy policy updated.

## Non-goals

- No server of ours touches the key or the prompts. No analytics, no proxy.
- No Zork II/III, no other Infocom titles in v1 (the engine should make them a registry entry plus a game file later).
- No account system, no sharing of generated media.
- No image-to-image continuity between rooms in v1 (style prefix plus bible only).

## Anti-goals (failure even if it technically works)

- The key leaking: into the URL, logs, the service worker cache, saves, or any request to a host other than OpenRouter.
- Surprise spend. The player must see that media costs money and be able to cap or turn it off, and the game must stay fully playable with no key.
- The game blocking on image generation. Text is instant; media arrives when ready.
- Prompts built from raw game text that include player-typed profanity or odd input verbatim without limits.

## Decisions by Greg

- Platform: PWA on the Cant Lose Software site, both games.
- Player supplies OpenRouter key.
- Video only at key moments (score gain, treasure, death, ending) and on player request.
- Player-selectable art style, consistent through the game.

## Constraints and facts

- Zork I, II, III source was released by Microsoft under the MIT license in November 2025 (ZIL source; compile with ZILF to a Z3 file). The license grants no trademark rights. [Microsoft announcement](https://opensource.microsoft.com/blog/?p=98292), [coverage](https://www.theregister.com/2025/11/21/microsoft_zork_source/).
- JS Z-machine interpreter: `ifvms` (ZVM), MIT, used by Parchment and Lectrote, last release 1.1.6 (2021). Supports Z3.
- OpenRouter images: chat completions with image output modalities. Video: asynchronous `/api/v1/videos` (submit, poll, download MP4), models such as Veo 3.1, Seedance, Wan, Sora 2 Pro; duration and aspect ratio vary by model. [OpenRouter video docs](https://openrouter.ai/docs/guides/overview/multimodal/video-generation). The builder must read the current docs and the live model list; model slugs here are examples, not commitments.
- Site rules (site `CLAUDE.md`): ASCII only content; colors only from `tokens.css`; brand-isolation test; anything sent off-device needs a privacy policy change first (`src/pages/support/privacy.astro`, Games); registry guard; shell tests loop over live games; every `caches.match` in the worker passes `{ ignoreVary: true }`; SW changes verified in a real browser offline; `src/lib/games/` logic is pure (no DOM, no `Date.now`/`Math.random` there).
- Games CSP/SW: the worker must never cache OpenRouter responses via the network path; media is stored by the game in IndexedDB, not the Cache API.

## Design

### Pieces

1. **Engine** (`src/lib/games/if/`): wraps ifvms ZVM; feeds a command, returns the game's text, plus parsed status (location name from the status line, score, moves). Pure of DOM.
2. **Event detector** (pure): from successive status/text, emits `newRoom(name, text)`, `scoreGain`, `treasure`, `death`, `ending`. Zork gives score on the status line. Adventure's Z-machine port is also scored; "treasure" is score gain on pickup.
3. **Prompt builder** (pure): style prefix + game bible + the room text (trimmed, length-capped) + safety suffix. Deterministic, unit tested. Video prompt adds the event.
4. **Media client** (browser): talks to OpenRouter only. Queue with one image in flight, retries, cancel. Video: submit, poll with backoff, download. All calls resolve to a result or a typed error, never throw to the UI.
5. **Media store**: IndexedDB keyed by game, style, and room or event id. Saved with the game save slot.
6. **UI**: GameShell page per game: terminal text pane, command input, picture pane that fills when ready (placeholder while loading, stays on the last picture if generation fails), style picker, settings (key, image model, video model, caps), Make a video button, offline/no key states.
7. **Settings**: key in `localStorage` under `cls.if-settings` (device-only), with a "forget key" button. Per-session spend guard: max images and max videos per session, defaults chosen by the builder, shown to the player.
8. **Privacy policy** text: room descriptions and the chosen style go to OpenRouter and the model provider using the player's own key; nothing goes to Cant Lose Software.

### Data flow

Player types command -> engine -> text shown at once -> detector -> if media enabled and key present and cap not reached: queue image (new room) or video (event) -> store -> show.

### Errors

No key: game fully playable, picture pane shows a "Add a key to see pictures" prompt. Bad key (401), out of credit (402), rate limit (429), model refused or content filtered: show a one-line message in the picture pane, keep playing, allow retry. Offline: use cached media only.

### Testing

Pure modules (engine wrapper, detector, prompt builder) get unit tests with recorded transcripts of known walkthrough moves for each game. The media client is tested against a mocked fetch, including the polling path. A runtime test boots the built page (happy-dom) with the engine and client mocked, as the other games do. The privacy test and registry/shell tests extend automatically. The builder verifies the SW offline path in a real browser, and does one real end-to-end run with a real key if Greg supplies one (never committed, never in the repo).

## Left to the builder

- Final style list and prompt wording; default models; spend-cap defaults; icon pixel grids; page copy; the exact event heuristics.
- Getting the Zork I game file (compile the MIT source with ZILF, or use a build artifact) and where it is stored (`public/games/zork/`).
- Adventure game file: choose a freely redistributable Z-machine port of the original Colossal Cave (the builder must verify its license before committing it, and record that in the spec).

## Open for Greg (answer before the plan)

1. **Name and trademark.** Microsoft's MIT grant covers code, not the "Zork" name. Ship as "Zork" anyway, or a descriptive title such as "Great Underground Empire" with a "based on Infocom's Zork I" credit? Builder default: use "Zork I" in the credit line only after you confirm.
2. **Adventure variant.** Original 1976 / 350-point version (Woods), assumed.

## Calls made by Claude (from the builder check; Greg may overrule)

1. Zork ships first. Finding a redistributable Z-machine Adventure with a clear license is its own plan task and may block the Adventure half only. If none exists, Adventure waits; no second interpreter in v1. Game files must run on ifvms (Z3 for Zork; any version ifvms supports for Adventure).
2. Event detection is one generic detector: score went up, death text, ending text, new location from the status line. Labels (treasure vs progress) are best effort and may be wrong; per-game text tables are optional polish.
3. Saves follow the convention the existing games already use (builder to read it). Media is cached globally per game + style + room id, not per slot. Style is fixed per game; changing style starts a fresh media set for that style and never deletes the old one.
4. One default image model and one default video model, each changeable as a plain model-slug text field in settings. No capability table; unsupported-model errors are shown as a one-line message.
5. Spend: a one-time cost notice the player must accept before the first call, plus per-session image and video caps. No live cost estimate in v1.
6. The player's typed commands never go into any prompt. Prompts use only game-file text and the fixed style and bible text.
7. Two pages (`/games/zork/`, `/games/adventure/`) sharing one library under `src/lib/games/if/`.
