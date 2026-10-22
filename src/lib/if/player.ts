// The player's own "About you and how it should look" text. Unlike game text it is not ASCII-stripped: it is what
// the player typed, in any language. It is cleaned of control and bidi characters, collapsed to one line and capped.
export const PLAYER_PROMPT_MAX = 500;

// C0/C1 controls (newlines and tabs are turned into spaces first), zero-width and bidi format characters.
const UNWANTED = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2069\ufeff]/g;

export function cleanPlayerPrompt(v: unknown): string {
  if (typeof v !== 'string') return '';
  const flat = v.replace(/[\t\r\n\u2028\u2029]+/g, ' ').replace(UNWANTED, '').replace(/\s+/g, ' ').trim();
  return Array.from(flat).slice(0, PLAYER_PROMPT_MAX).join('').trim();
}

// cyrb53: a small, fast, deterministic 53-bit string hash. Not for security; it only tells cache entries apart.
function hash53(s: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * The media-cache namespace for a style and a player description: the style id alone when there is no description
 * (so pictures made before the feature existed are still found), else the style id plus a short hash of the
 * normalized description. Pictures made under another namespace stay stored; they are just not shown.
 */
export function mediaNamespace(styleId: string, playerPrompt: string): string {
  const p = cleanPlayerPrompt(playerPrompt);
  return p ? `${styleId}.${hash53(`${styleId}\n${p}`).toString(36).padStart(10, '0')}` : styleId;
}
