// Local saves for the illustrated adventures. Parse-or-replace: bad or missing data gives a fresh value and
// nothing here throws (private mode, a full disk and a blocked storage all just mean the game does not remember).
// Two keys: `cls.if-zork` is the game save (art style plus the engine's Quetzal bytes) and never holds the
// OpenRouter key; `cls.if-settings` is the device-only settings record, key included, per the spec.
import { defaultSettings, parseSettings, type Settings } from './settings';
import { STYLES } from './styles';

export const GAME_SAVE_KEY = 'cls.if-zork';
export const SETTINGS_KEY = 'cls.if-settings';

export interface GameSave {
  styleId: string | null;
  bytes: Uint8Array | null;
}

export const freshGameSave = (): GameSave => ({ styleId: null, bytes: null });

const CHUNK = 0x8000;

export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

export function fromBase64(text: string): Uint8Array | null {
  if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return null;
  try {
    const bin = atob(text);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export function loadGameSave(storage: Pick<Storage, 'getItem'> | undefined): GameSave {
  try {
    const raw: unknown = JSON.parse(storage?.getItem(GAME_SAVE_KEY) ?? 'null');
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return freshGameSave();
    const s = raw as Record<string, unknown>;
    if (s.version !== 1) return freshGameSave();
    const styleId = typeof s.styleId === 'string' && STYLES.some((x) => x.id === s.styleId) ? s.styleId : null;
    const bytes = typeof s.bytes === 'string' ? fromBase64(s.bytes) : null;
    return { styleId, bytes };
  } catch {
    return freshGameSave();
  }
}

export function writeGameSave(storage: Pick<Storage, 'setItem'> | undefined, save: GameSave): void {
  try {
    storage?.setItem(
      GAME_SAVE_KEY,
      JSON.stringify({ version: 1, styleId: save.styleId, bytes: save.bytes ? toBase64(save.bytes) : null }),
    );
  } catch {
    // Private mode or a full disk: the game plays on and simply does not remember.
  }
}

export function loadSettings(storage: Pick<Storage, 'getItem'> | undefined): Settings {
  try {
    return parseSettings(JSON.parse(storage?.getItem(SETTINGS_KEY) ?? 'null'));
  } catch {
    return defaultSettings();
  }
}

export function writeSettings(storage: Pick<Storage, 'setItem'> | undefined, settings: Settings): void {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Same as the game save.
  }
}
