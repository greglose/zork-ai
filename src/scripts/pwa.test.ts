import { describe, expect, it, vi } from 'vitest';
import { registerSW, safeStorage } from './pwa';

describe('registerSW', () => {
  it('registers the worker at the base, with the base as scope', async () => {
    const register = vi.fn(async () => ({}));
    await registerSW({ base: '/zork-ai/', dev: false, container: { register } });
    expect(register).toHaveBeenCalledWith('/zork-ai/sw.js', { scope: '/zork-ai/' });
  });
  it('does nothing in dev', async () => {
    const register = vi.fn(async () => ({}));
    await registerSW({ base: '/', dev: true, container: { register } });
    expect(register).not.toHaveBeenCalled();
  });
  it('does nothing when service workers are unavailable', async () => {
    await expect(registerSW({ base: '/', dev: false, container: undefined })).resolves.toBeUndefined();
  });
  it('swallows a registration failure (offline support is best-effort)', async () => {
    const register = vi.fn(async () => { throw new Error('nope'); });
    await expect(registerSW({ base: '/', dev: false, container: { register } })).resolves.toBeUndefined();
  });
});

describe('safeStorage', () => {
  it('returns undefined when the browser blocks storage', () => {
    vi.stubGlobal('window', { get localStorage(): Storage { throw new Error('blocked'); } });
    expect(safeStorage()).toBeUndefined();
    vi.unstubAllGlobals();
  });
});
