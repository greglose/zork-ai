/** window.localStorage, or undefined when the browser blocks access to it. */
export function safeStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export interface SWOptions {
  /** Site base such as "/zork-ai/". The worker lives at <base>sw.js and controls <base>. */
  base: string;
  dev: boolean;
  container: { register(url: string, options: { scope: string }): Promise<unknown> } | undefined;
}

/** Registers the offline worker. Skipped in dev; failures are ignored because the page works without it. */
export async function registerSW({ base, dev, container }: SWOptions): Promise<void> {
  if (dev || !container) return;
  try {
    await container.register(`${base}sw.js`, { scope: base });
  } catch {
    // Offline support is best-effort.
  }
}
