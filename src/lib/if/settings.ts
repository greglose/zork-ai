import { cleanPlayerPrompt } from './player';
import { STYLES } from './styles';
import type { GameId } from './types';

// Default model slugs chosen 2026-10-20 from the live OpenRouter catalog:
// - video: https://openrouter.ai/api/v1/videos/models (docs: /docs/guides/overview/multimodal/video-generation)
//   x-ai/grok-imagine-video-1.5-lite, lowest-cost video model listed (3 cents/s at 720p).
// - image: https://openrouter.ai/api/v1/models?output_modalities=image (docs: /docs/guides/overview/multimodal/image-generation)
//   black-forest-labs/flux-3-image-klein, among the cheapest image outputs.
// Both are editable in the settings panel; slugs change often.
export type Settings = {
  key: string | null;
  imageModel: string;
  videoModel: string;
  styleByGame: Partial<Record<GameId, string>>;
  /** The player's own "About you and how it should look" text; cleaned, at most 500 characters. */
  playerPrompt: string;
  consented: boolean;
  maxImages: number;
  maxVideos: number;
};

export function defaultSettings(): Settings {
  return {
    key: null,
    imageModel: 'black-forest-labs/flux-3-image-klein',
    videoModel: 'x-ai/grok-imagine-video-1.5-lite',
    styleByGame: {},
    playerPrompt: '',
    consented: false,
    maxImages: 40,
    maxVideos: 5,
  };
}

const GAMES: GameId[] = ['zork', 'adventure'];
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200;
const isCap = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1000;

export function parseSettings(raw: unknown): Settings {
  const d = defaultSettings();
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return d;
  const r = raw as Record<string, unknown>;
  const styleByGame: Partial<Record<GameId, string>> = {};
  const sb = r.styleByGame;
  if (typeof sb === 'object' && sb !== null && !Array.isArray(sb)) {
    for (const g of GAMES) {
      const v = (sb as Record<string, unknown>)[g];
      if (typeof v === 'string' && STYLES.some((s) => s.id === v)) styleByGame[g] = v;
    }
  }
  return {
    key: isStr(r.key) ? r.key : null,
    imageModel: isStr(r.imageModel) ? r.imageModel : d.imageModel,
    videoModel: isStr(r.videoModel) ? r.videoModel : d.videoModel,
    styleByGame,
    playerPrompt: cleanPlayerPrompt(r.playerPrompt),
    consented: r.consented === true,
    maxImages: isCap(r.maxImages) ? r.maxImages : d.maxImages,
    maxVideos: isCap(r.maxVideos) ? r.maxVideos : d.maxVideos,
  };
}

export function createSpendGuard(s: Settings) {
  let images = 0;
  let videos = 0;
  const ok = () => s.consented && !!s.key;
  return {
    canImage: () => ok() && images < s.maxImages,
    canVideo: () => ok() && videos < s.maxVideos,
    noteImage: () => void (images += 1),
    noteVideo: () => void (videos += 1),
    reset: () => {
      images = 0;
      videos = 0;
    },
  };
}
