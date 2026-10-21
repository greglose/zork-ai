> Historical copy from the Cant Lose Software site, where this feature was designed. File paths, the `/games/` section, the CLS site rules and the `cls.*` storage keys refer to that site. In this repo the code lives under `src/lib/if/` and `src/scripts/`, the page is `src/pages/index.astro`, and the story file is `public/zork1.z3`.

# Illustrated Adventures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use feature-swarm (user's standing route for multi-task plans; subagent-driven-development is not used). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zork I and Colossal Cave Adventure as offline-capable PWA pages in the CLS `/games/` section, with OpenRouter-generated room pictures, key-moment video, and a player-picked consistent art style.

**Architecture:** A pure library under `src/lib/games/if/` (engine wrapper over ifvms, status parser, event detector, prompt builder, settings and cost guard) plus browser code under `src/scripts/games/if/` (OpenRouter client, IndexedDB media store, UI). Two pages share the library; each is a registry entry rendered in `GameShell`. No backend.

**Tech Stack:** Astro 7, TypeScript 6, Vitest + happy-dom, `ifvms` (MIT), IndexedDB, OpenRouter REST.

**Spec:** `docs/superpowers/specs/2026-10-20-illustrated-adventures-design.md`

## Global Constraints

- Site `CLAUDE.md` rules apply: ASCII-only content (no curly quotes or long dashes); colors only from `src/styles/tokens.css`; `You 2.0` and `youtwopointo` must not appear in `dist/`; every `caches.match` in `src/lib/pwa/sw.js` passes `{ ignoreVary: true }`; code under `src/lib/games/` is pure (no DOM, no `Date.now`, no `Math.random`).
- Anything sent off-device needs the privacy policy changed first (`src/pages/support/privacy.astro`, Games section).
- The key goes only to `https://openrouter.ai`; it is never in a URL, a log, a save, the Cache API, or the service worker. `localStorage` key `cls.if-settings`.
- Player-typed commands never enter any prompt.
- Game must be fully playable with no key, offline, and while generation is pending or failing.
- Page title is the registry entry's `name` only (single place). Greg chose "A Zork - AI based interpretation" for Zork (use `name`: "Zork: An AI Interpretation", ASCII only); keep a credit line "based on Infocom's Zork I, released by Microsoft under the MIT license" on the page and in `LICENSE-ZORK.txt`. Adventure's title is the builder's call, same pattern ("Colossal Cave: An AI Interpretation").
- Zork ships first; Adventure may block on its license check without blocking Zork.

## Review Focus

- Empty command / game prints nothing: no new media requested, no crash.
- Same room reached by two routes or after restore: image comes from cache, no second paid call.
- 401, 402, 429, content-filter refusal, and network drop mid-poll: one-line message, game keeps going, retry works.
- Player changes style mid-game: old style's media kept, new style gets its own set; no mixing.
- Key removed ("forget key") while a request is in flight: the result is discarded, nothing is stored.

---

### Task 1: Game files and ifvms dependency

**Files:**
- Create: `public/games/zork/zork1.z3`, `public/games/zork/LICENSE-ZORK.txt`, `docs/games/if-game-files.md` (how each file was produced, source URL, license, SHA-256)
- Modify: `package.json` (add `ifvms`)

**Interfaces:**
- Produces: story files served at `/games/zork/zork1.z3` and (if licensing clears) `/games/adventure/adventure.z5` (extension per the chosen build).

- [ ] **Step 1:** Build Zork I from the MIT source with ZILF per Microsoft's release notes; record source commit and SHA-256 in `docs/games/if-game-files.md`; commit the MIT text beside it.
- [ ] **Step 2:** Find a Z-machine build of the 1976 350-point Colossal Cave whose license allows web redistribution and whose version ifvms runs. Record license and source. If none is clean, write "BLOCKED" in the doc and skip all Adventure steps in later tasks (ship Zork only).
- [ ] **Step 3:** `npm i ifvms`; in a scratch node script load the Zork file, send `look`, confirm text contains "West of House". Delete the script. Record the ifvms entry points actually used in the doc.
- [ ] **Step 4:** Commit.

### Task 2: Engine wrapper

**Files:**
- Create: `src/lib/games/if/engine.ts`, `src/lib/games/if/engine.test.ts`

**Interfaces:**
- Produces: `createEngine(story: Uint8Array): Engine` where `Engine = { start(): Promise<Turn>; send(command: string): Promise<Turn>; save(): Uint8Array; restore(data: Uint8Array): Promise<Turn> }` and `Turn = { text: string; status: { location: string; score: number; moves: number } | null; finished: boolean }`.

- [ ] **Step 1:** Test `zork_start_text_contains_west_of_house`, `zork_open_mailbox_text_contains_leaflet`, `status_has_location_and_score_zero_at_start`, `save_then_restore_returns_same_location`, `empty_command_returns_empty_new_text_without_throwing`.
- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Implement `createEngine` in `engine.ts` over ifvms ZVM; status from the Z3 status line; no DOM use (story bytes passed in by caller).
- [ ] **Step 4:** Run tests, expect PASS.
- [ ] **Step 5:** Commit.

### Task 3: Event detector

**Files:**
- Create: `src/lib/games/if/events.ts`, `src/lib/games/if/events.test.ts`

**Interfaces:**
- Consumes: `Turn` from Task 2.
- Produces: `type GameEvent = { kind: 'newRoom'; roomId: string; roomName: string; text: string } | { kind: 'scoreGain'; delta: number; text: string } | { kind: 'death'; text: string } | { kind: 'ending'; text: string }`; `createDetector(): { next(turn: Turn): GameEvent[] }`. `roomId` is the lower-cased, trimmed status location name.

- [ ] **Step 1:** Tests from recorded transcripts: first turn yields `newRoom` "west of house"; moving north yields `newRoom` "north of house"; returning to a seen room yields `newRoom` again with the same `roomId` (the caller decides caching); score 0 to 10 yields `scoreGain` delta 10; text containing "You have died" yields `death`; `finished` true yields `ending`; a turn with no status yields no events.
- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Implement `createDetector`; generic per spec (no per-game tables).
- [ ] **Step 4:** Run, expect PASS.
- [ ] **Step 5:** Commit.

### Task 4: Styles, bibles and prompt builder

**Files:**
- Create: `src/lib/games/if/styles.ts`, `src/lib/games/if/bible.ts`, `src/lib/games/if/prompt.ts`, `src/lib/games/if/prompt.test.ts`

**Interfaces:**
- Produces: `STYLES: readonly { id: string; label: string; prefix: string }[]` (at least `cartoon`, `photo`, `anime`, `watercolor`, `pixel`); `BIBLES: Record<'zork' | 'adventure', string>` (a few lines on the look of the key places and objects); `buildImagePrompt(i: { game: GameId; styleId: string; roomName: string; text: string }): string`; `buildVideoPrompt(i: { game: GameId; styleId: string; roomName: string; event: GameEvent }): string`. `GameId = 'zork' | 'adventure'`.

- [ ] **Step 1:** Tests: `image_prompt_starts_with_style_prefix`, `image_prompt_contains_bible`, `room_text_capped_at_600_chars`, `output_is_ascii_only`, `unknown_style_throws`, `prompt_is_deterministic`, `video_prompt_mentions_event_kind`. No test passes a player command because the builder has no parameter for one.
- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Implement; strip non-ASCII from room text; trim and cap.
- [ ] **Step 4:** Run, expect PASS.
- [ ] **Step 5:** Commit.

### Task 5: Settings, consent and spend guard

**Files:**
- Create: `src/lib/games/if/settings.ts`, `src/lib/games/if/settings.test.ts`

**Interfaces:**
- Produces: `type Settings = { key: string | null; imageModel: string; videoModel: string; styleByGame: Partial<Record<GameId, string>>; consented: boolean; maxImages: number; maxVideos: number }`; `defaultSettings(): Settings`; `parseSettings(raw: unknown): Settings` (bad data replaced, never trusted); `createSpendGuard(s: Settings): { canImage(): boolean; canVideo(): boolean; noteImage(): void; noteVideo(): void; reset(): void }`.

- [ ] **Step 1:** Tests: `parse_bad_json_gives_defaults`, `parse_drops_unknown_style`, `guard_blocks_image_at_cap`, `guard_blocks_when_not_consented`, `guard_blocks_when_no_key`, `reset_clears_counts`.
- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Implement. Defaults: caps 40 images and 5 videos per session (builder's call, shown to the player); model slugs from the live OpenRouter docs read in this step and recorded in a code comment.
- [ ] **Step 4:** Run, expect PASS.
- [ ] **Step 5:** Commit.

### Task 6: OpenRouter client (image and video)

**Files:**
- Create: `src/scripts/games/if/openrouter.ts`, `src/scripts/games/if/openrouter.test.ts`

**Interfaces:**
- Produces: `type MediaResult<T> = { ok: true; value: T } | { ok: false; reason: 'no-key' | 'auth' | 'credit' | 'rate' | 'refused' | 'network' | 'timeout' | 'bad-response' }`; `createOpenRouter(deps: { fetch: typeof fetch; getKey: () => string | null; sleep: (ms: number) => Promise<void> }): { image(model: string, prompt: string, signal?: AbortSignal): Promise<MediaResult<Blob>>; video(model: string, prompt: string, signal?: AbortSignal): Promise<MediaResult<Blob>> }`.

- [ ] **Step 1:** Tests with mocked fetch: `image_sends_key_only_in_authorization_header_to_openrouter_host`, `image_returns_blob_from_data_url`, `maps_401_to_auth_402_to_credit_429_to_rate`, `video_submits_then_polls_until_completed_then_downloads`, `video_poll_gives_timeout_after_limit`, `network_error_gives_network_not_throw`, `aborted_signal_gives_network`, `no_key_gives_no_key_without_calling_fetch`.
- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Implement per the OpenRouter docs read in Task 5 (image via chat completions image output; video via `/api/v1/videos` submit, poll, content download). Poll backoff and limit are builder's call.
- [ ] **Step 4:** Run, expect PASS.
- [ ] **Step 5:** Commit.

### Task 7: Media store

**Files:**
- Create: `src/scripts/games/if/media-store.ts`, `src/scripts/games/if/media-store.test.ts`

**Interfaces:**
- Produces: `createMediaStore(idb: IDBFactory): { get(k: MediaKey): Promise<Blob | null>; put(k: MediaKey, b: Blob): Promise<void>; clear(game: GameId): Promise<void> }` where `MediaKey = { game: GameId; styleId: string; kind: 'image' | 'video'; id: string }`. All methods resolve (never throw) when IndexedDB is unavailable.

- [ ] **Step 1:** Tests (fake-indexeddb or happy-dom IDB): `put_then_get_roundtrips`, `different_style_is_a_different_entry`, `missing_returns_null`, `unavailable_idb_get_returns_null_put_resolves`.
- [ ] **Step 2:** Run, expect FAIL. **Step 3:** Implement. **Step 4:** Run, expect PASS. **Step 5:** Commit.

### Task 8: Zork page, registry entry, UI controller

**Files:**
- Create: `src/content/games/zork.json`, `src/pages/games/zork/index.astro`, `src/scripts/games/if/main.ts`, `src/scripts/games/if/ui.ts`, `src/scripts/games/if/controller.ts`, `src/scripts/games/if/controller.test.ts`
- Run: `npm run icons:games`

**Interfaces:**
- Consumes: Tasks 2-7.
- Produces: `createController(d: { engine: Engine; detector; settings; guard; openrouter; store; ui: IfUi; game: GameId }): { command(text: string): Promise<void>; requestVideo(): Promise<void>; setStyle(id: string): void }`; `IfUi` has `showText(t: string)`, `showImage(b: Blob | null)`, `showVideo(b: Blob)`, `showNotice(msg: string)`, `setBusy(b: boolean)`.

- [ ] **Step 1:** Controller tests with fakes: `text_shown_before_image_requested`, `new_room_requests_image_once_then_uses_cache`, `scoreGain_requests_video_when_allowed`, `no_key_shows_notice_and_plays_on`, `cap_reached_skips_generation_with_notice`, `failed_image_shows_notice_and_keeps_last_picture`, `request_video_button_uses_current_room`, `style_change_uses_new_cache_namespace`, `result_after_key_forgotten_is_discarded`, `no_player_command_text_in_any_prompt` (spy on openrouter args).
- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Implement controller (one image in flight, queue newest-wins). Build the page in `GameShell` with text pane, command input, picture pane, style picker, settings panel (key field, model slugs, forget key, cost notice accept), Make a video button, How to play slot. Saves follow the mine-lode `save.ts` convention (read it first): engine bytes plus current style, key never included.
- [ ] **Step 4:** Add the registry entry (`status: live`, `display: standalone`), run `npm run icons:games`, run `npm test` fully (registry guard and shell tests loop over it automatically).
- [ ] **Step 5:** Commit.

### Task 9: Privacy, offline, runtime test, docs

**Files:**
- Modify: `src/pages/support/privacy.astro` (Games section), `src/lib/pwa/sw.js` only if story files need precache (keep `{ ignoreVary: true }`), `CLAUDE.md` (new Games bullet)
- Create: `tests/games-if-runtime.test.ts` (happy-dom, built page, engine and OpenRouter mocked), `tests/games-if-build.test.ts` (script size cap, no `rgba(`/`blur(` only if the page follows the retro token rule; otherwise just size cap)

- [ ] **Step 1:** Tests: privacy page text states that room descriptions and the style go to OpenRouter using the player's own key and nothing goes to Cant Lose Software; built Zork page contains no `<script src>` to openrouter; runtime test boots page, types `open mailbox`, sees the leaflet text, sees an image request made, sees no image request after the same room again.
- [ ] **Step 2:** Run, expect FAIL. **Step 3:** Implement. **Step 4:** Run `npm run verify`, expect PASS.
- [ ] **Step 5:** In a real browser: load `/games/zork/`, play, set offline, reload, confirm text game and cached pictures work (SW rule). Record result in `docs/STATE.md`.
- [ ] **Step 6:** Commit.

### Task 10: Adventure (only if Task 1 step 2 cleared)

**Files:**
- Create: `src/content/games/adventure.json`, `src/pages/games/adventure/index.astro`, test additions to `engine.test.ts`, `events.test.ts`, `controller.test.ts`

- [ ] **Step 1:** Tests: `adventure_start_text_contains_end_of_a_road`, `adventure_status_parses`, `adventure_score_gain_detected`, controller tests parameterized over `game: 'adventure'`.
- [ ] **Step 2:** Run, expect FAIL. **Step 3:** Add game, bible text already in `BIBLES`, page; fix any status-line differences in `engine.ts`. **Step 4:** Run `npm run verify`, expect PASS. **Step 5:** Offline browser check as Task 9 step 5, then commit.

### Task 11: End-to-end with a real key (only if Greg supplies one)

- [ ] **Step 1:** Greg enters his key in the running page (never in the repo or chat); play to a score gain; confirm picture and video appear and costs stay under the caps. Record result in `docs/STATE.md`.

## Self-review notes

Spec coverage: engine (T2), picture per room and cache (T3, T7, T8), video moments plus on-demand (T3, T8), style and bible (T4), key/caps/consent (T5), privacy/offline/site rules (T9), Adventure (T10), error paths (T6, T8). Review Focus items each map to a test above.
