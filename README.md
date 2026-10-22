# Zork AI

Infocom's Zork I in your browser, with an AI-made picture of each new place and short video clips at key moments.
The game runs entirely on your device. The pictures are optional and come from your own OpenRouter account.

Live site (GitHub Pages): https://greglose.github.io/zork-ai/

## How it works

- `public/zork1.z3` is a Z-machine story file. [ifvms](https://github.com/curiousdannii/ifvms.js) runs it in the page
  (`src/lib/if/engine.ts`, no DOM). Text comes back at once; the game never waits for a picture.
- When you enter a place you have not pictured yet, the page sends a prompt for that place and your chosen art style to
  OpenRouter and asks for one image. When the game shows a visible change there (the rug moved, the lamp lit...), the
  place is drawn again once, building on its earlier picture where the image model allows it (see Scene prompts). Pictures are stored in this browser (IndexedDB), so a place you revisit costs
  nothing. A short video is made when your score goes up, when you die, and at the end, or when you press Make a video.
- Each session is capped (default 40 pictures and 5 videos; see Settings). Reloading starts a new session.
- Your position, art style and settings are saved in this browser's local storage.
- It works offline after the first visit: a small service worker caches the page, scripts and the story file. It never
  touches a request to another origin.

## About you and how it should look

Under Settings you can describe yourself and the look you want, up to 500 characters, for example: *I am a woman
adventurer dressed for a day of hiking. I wish to explore a colorful cartoon version of this game.* It is added to every
picture and video request as a clearly marked block: the model is asked to follow it for how the player character looks,
to let it override the chosen art style if it asks for a different look, and to show the character where it fits
naturally (for example from behind). It is sent to OpenRouter and the model provider, so leave out anything private.
Press **Redraw picture** to apply a change to the place you are in. Pictures made with another description (or style)
stay stored in this browser and come back if you switch back; they are keyed by a short hash of the style and the text.

## Scene prompts (data files)

Pictures are not drawn from the game's raw room text. Hand-written prompts live as data in `src/lib/if/scenes/` and are
read through `src/lib/if/scenes/index.ts`:

- `rooms.json`: one object per place, keyed by **room id**, `{ "prompt": "...", "dark": true }`. The id is the lowercased,
  trimmed name the game's status line shows (the `DESC` string in Zork's `1dungeon.zil`), for example `"west of house"` or
  `"the troll room"`. Zork I has 110 `<ROOM>` definitions but only 78 distinct names, because some share one (15 mazes,
  4 forests, 5 dead ends, 5 river stretches...); each name gets one prompt. A prompt is 40-80 words, plain ASCII, purely
  visual (layout, fixed features, light, mood, how the exits look), with no art style, no characters, no lettering and no
  spoilers: the style comes from the picker and the player's own description. `dark` is true when the room has no light of
  its own (no `ONBIT` flag in the source); a dark room entered without a lamp ("It is pitch black") is drawn almost black.
- `moments.json`: an array of `{ "id", "roomId", "when", "prompt" }` for visible changes in a place. `when` is a
  case-insensitive regular expression source tested against the new game text of a single turn while the player is in
  `roomId`; `prompt` describes the same view with the change ("Same view, but ..."). When one matches, it fires once per
  game: the place is drawn again from its room prompt plus the changes so far, with the earlier picture as a reference
  image when the chosen model accepts one (otherwise from the prompt alone), and that picture replaces the place from then
  on, in every style, while the earlier ones stay stored but unshown. Fired moments are saved with the game
  (`cls.if-zork`). Triggers are taken from the TELL strings in the game source.

Unknown rooms fall back to the generic prompt built from the game's own text. Tests: `tests/scenes.test.ts` checks that
every room in the source has a prompt (the list is `tests/fixtures/zork-rooms.json`, produced by
`scripts/extract-zork-rooms.mjs` from a clone of the source), lints every prompt (word counts, ASCII, no style or
lettering words, no characters), checks every trigger against the exact game string
(`tests/fixtures/moment-strings.json`) and replays the real game to prove 13 of the moments fire in the right room.

## Bring your own OpenRouter key

Pictures and videos need an [OpenRouter](https://openrouter.ai) key. Without one the game is fully playable as text.

- Open Settings, read the cost notice, accept it, paste your key.
- **Cost:** generation is billed by OpenRouter to your account, per picture and per video. Videos cost more than
  pictures. The default models and the session caps are in Settings; set a spending limit on your OpenRouter key.
- **The key stays in your browser.** It is kept in local storage on this device and goes only to `openrouter.ai`, in an
  `Authorization` header (never in a URL). Anyone who can use your browser profile can read it. "Forget key" removes it.

## Privacy

- Sent to OpenRouter and the model provider it routes to: the **prompt for the place** (written ahead of time from the
  game, or the room text the game printed when there is none), your
  **art style** and, if you wrote one, your **"About you and how it should look"** text (see below).
- **Not sent:** the commands you type. The prompt builder only ever sees the room name, the place's prompt or the game's
  own room text, the style, your description and the fixed text of any moment (`src/scripts/controller.ts` strips the echoed command; `src/scripts/controller.test.ts`
  and `tests/runtime.test.ts` pin that no command reaches a prompt while your description does).
- Your description is stored only in this browser's local storage, with your other settings.
- Nothing is sent to the author of this app. No analytics, no cookies, no other third-party requests.

## Run it

```
npm i
npm run dev      # http://localhost:4321/zork-ai/
npm test         # builds the site, then runs every spec (vitest, happy-dom)
npm run build    # static site in dist/
npm run preview
npm run check    # astro check
```

The site is served under a base path. Defaults are `https://greglose.github.io` and `/zork-ai/`; override with the
`ZORK_SITE` and `ZORK_BASE` environment variables (for example `ZORK_BASE=/ npm run build` for a domain root). Asset
URLs, the web manifest and the service worker scope all follow the base.

Deployment: `.github/workflows/pages.yml` builds with `npm ci && npm run build` and publishes `dist/` to GitHub Pages
on every push to `main` (enable Pages with source "GitHub Actions" in the repo settings).

## Where `zork1.z3` comes from

Built from Microsoft's MIT-licensed Zork I ZIL source (https://github.com/historicalsource/zork1) with the ZILF
compiler; the `.zil` files only, not the repo's pre-compiled files. Exact commits, the build commands and the file hash
are in [docs/if-game-files.md](docs/if-game-files.md). The design and the implementation plan are in `docs/`.

## Credits and licenses

- Zork I by Infocom, source released by Microsoft under the MIT license (`public/LICENSE-ZORK.txt`). "Zork" is a
  trademark of its owner; this is an unofficial interpretation and is not affiliated with or endorsed by them.
- [ifvms](https://github.com/curiousdannii/ifvms.js) and glkote-term, both MIT.
- Everything else: MIT, copyright 2026 Greg Lose (`LICENSE`). Third-party texts are in `THIRD-PARTY-NOTICES.md`.
- A [Cant Lose Software](https://cantlosesoftware.com) project.
