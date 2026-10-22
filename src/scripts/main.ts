// Page script for the illustrated adventures. One engine per page load (the Glk layer is module-level state).
import { createEngine } from '../lib/if/engine';
import { PLAYER_PROMPT_MAX, cleanPlayerPrompt } from '../lib/if/player';
import { createDetector } from '../lib/if/events';
import { loadGameSave, loadSettings, writeGameSave, writeSettings } from '../lib/if/save';
import { createSpendGuard } from '../lib/if/settings';
import type { GameId } from '../lib/if/types';
import { createController } from './controller';
import { createMediaStore } from './media-store';
import { createOpenRouter } from './openrouter';
import { registerSW, safeStorage } from './pwa';
import { createUi, findElements } from './ui';

const GAME: GameId = 'zork';
const STORY_FILE = 'zork1.z3';

async function init(): Promise<void> {
  const root = document.querySelector<HTMLElement>('[data-game]');
  if (!root) return;
  const q = <T extends HTMLElement>(sel: string): T => root.querySelector<T>(sel)!;
  const storage = safeStorage();
  const settings = loadSettings(storage);
  const save = loadGameSave(storage);
  if (save.styleId) settings.styleByGame[GAME] = save.styleId;
  const guard = createSpendGuard(settings);
  const els = findElements(root);
  const ui = createUi(els);

  // ---- Settings panel -------------------------------------------------------------------------------------
  const keyField = q<HTMLInputElement>('[data-key]');
  const imageModel = q<HTMLInputElement>('[data-image-model]');
  const videoModel = q<HTMLInputElement>('[data-video-model]');
  const consent = q<HTMLInputElement>('[data-consent]');
  const styleSelect = q<HTMLSelectElement>('[data-style]');
  const playerField = q<HTMLTextAreaElement>('[data-player-prompt]');
  const playerCount = q('[data-player-count]');
  const playerCountLive = q('[data-player-count-live]');
  const caps = q('[data-caps]');
  const status = q('[data-settings-status]');
  keyField.value = settings.key ?? '';
  imageModel.value = settings.imageModel;
  videoModel.value = settings.videoModel;
  playerField.value = settings.playerPrompt;
  consent.checked = settings.consented;
  styleSelect.value = settings.styleByGame[GAME] ?? styleSelect.value;
  caps.textContent = `This session: up to ${settings.maxImages} pictures and ${settings.maxVideos} videos. Reloading the page starts a new session.`;
  const persistSettings = () => writeSettings(storage, settings);
  const slug = (field: HTMLInputElement, fallback: string) => field.value.trim().slice(0, 200) || fallback;

  const countText = () => `${playerField.value.length} of ${PLAYER_PROMPT_MAX} characters`;
  playerCount.textContent = countText();
  // Keep what the player typed in settings, cleaned. Also run before a picture or video is asked for, so text typed
  // a moment ago is never missed.
  const commitPlayerPrompt = () => {
    const cleaned = cleanPlayerPrompt(playerField.value);
    if (cleaned !== settings.playerPrompt) {
      settings.playerPrompt = cleaned;
      persistSettings();
    }
    if (playerField.value !== cleaned) playerField.value = cleaned;
  };
  // The visible count follows every keystroke but is hidden from screen readers; the polite live region is only
  // updated when the player is done with the field, so it is not announced per keystroke.
  playerField.addEventListener('input', () => {
    playerCount.textContent = countText();
  });
  for (const type of ['change', 'blur'] as const) {
    playerField.addEventListener(type, () => {
      commitPlayerPrompt();
      playerCount.textContent = countText();
      playerCountLive.textContent = countText();
    });
  }

  keyField.addEventListener('input', () => {
    settings.key = keyField.value.trim().slice(0, 200) || null;
    persistSettings();
  });
  imageModel.addEventListener('change', () => {
    settings.imageModel = slug(imageModel, settings.imageModel);
    imageModel.value = settings.imageModel;
    persistSettings();
  });
  videoModel.addEventListener('change', () => {
    settings.videoModel = slug(videoModel, settings.videoModel);
    videoModel.value = settings.videoModel;
    persistSettings();
  });
  consent.addEventListener('change', () => {
    settings.consented = consent.checked;
    persistSettings();
  });
  q('[data-act="forget"]').addEventListener('click', () => {
    settings.key = null;
    keyField.value = '';
    persistSettings();
    status.textContent = 'Key forgotten. It is no longer stored on this device.';
  });

  // ---- Game -----------------------------------------------------------------------------------------------
  const base = import.meta.env.BASE_URL;
  let bytes: Uint8Array;
  try {
    const res = await fetch(`${base}${STORY_FILE}`);
    if (!res.ok) throw new Error(String(res.status));
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch {
    ui.showText('The game file could not be loaded. Check your connection and reload the page.');
    return;
  }

  const engine = createEngine(bytes);
  const controller = createController({
    engine,
    detector: createDetector(),
    settings,
    guard,
    openrouter: createOpenRouter({
      fetch: (input, init) => fetch(input, init),
      getKey: () => settings.key,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    }),
    store: createMediaStore(typeof indexedDB === 'undefined' ? (undefined as unknown as IDBFactory) : indexedDB),
    ui,
    game: GAME,
  });

  const persistGame = () => {
    try {
      writeGameSave(storage, { styleId: settings.styleByGame[GAME] ?? null, bytes: engine.save(), moments: controller.firedMoments() });
    } catch {
      // The game cannot save right now (for example after it ended): play on.
    }
  };

  // Commands run one at a time, in the order typed.
  let chain: Promise<void> = Promise.resolve();
  const run = (text: string) => {
    chain = chain
      .then(() => controller.command(text))
      .then(persistGame)
      .catch(() => ui.showNotice('The game stopped unexpectedly. Reload the page to continue from your last save.'));
  };

  q<HTMLFormElement>('[data-form]').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = els.input.value.trim();
    els.input.value = '';
    els.input.focus();
    if (!text) return;
    ui.showCommand(text);
    run(text);
  });
  styleSelect.addEventListener('change', () => {
    controller.setStyle(styleSelect.value);
    persistSettings();
    persistGame();
  });
  q('[data-act="video"]').addEventListener('click', () => {
    commitPlayerPrompt();
    void controller.requestVideo();
  });
  q('[data-act="retry"]').addEventListener('click', () => {
    commitPlayerPrompt();
    controller.retryImage();
  });

  await controller.start(save.bytes ?? undefined, save.moments);
  persistGame();
  els.input.focus({ preventScroll: true });
  void registerSW({ base, dev: import.meta.env.DEV, container: 'serviceWorker' in navigator ? navigator.serviceWorker : undefined });
}

void init();
