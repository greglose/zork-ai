import { describe, expect, it, vi } from 'vitest';
import { createOpenRouter } from './openrouter';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const noSleep = () => Promise.resolve();
const PNG_B64 = btoa('fakepng');

function make(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>, key: string | null = 'sk-or-secret') {
  const fetch = vi.fn(fetchImpl) as unknown as typeof globalThis.fetch & ReturnType<typeof vi.fn>;
  const sleep = vi.fn(noSleep);
  return { client: createOpenRouter({ fetch, getKey: () => key, sleep }), fetch: fetch as ReturnType<typeof vi.fn>, sleep };
}

describe('openrouter image', () => {
  it('image_sends_key_only_in_authorization_header_to_openrouter_host', async () => {
    const { client, fetch } = make(async () => json({ data: [{ b64_json: PNG_B64, media_type: 'image/png' }] }));
    await client.image('m/img', 'a cave');
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).host).toBe('openrouter.ai');
    expect(url).not.toContain('sk-or-secret');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-or-secret');
    expect(String(init.body)).not.toContain('sk-or-secret');
    expect(JSON.parse(String(init.body))).toMatchObject({ model: 'm/img', prompt: 'a cave' });
  });

  it('image_returns_blob_from_data_url', async () => {
    const { client } = make(async () => json({ data: [{ url: `data:image/webp;base64,${PNG_B64}` }] }));
    const r = await client.image('m', 'p');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.type).toBe('image/webp');
      expect(await r.value.text()).toBe('fakepng');
    }
  });

  it('image_returns_blob_from_b64_json', async () => {
    const { client } = make(async () => json({ data: [{ b64_json: PNG_B64, media_type: 'image/png' }] }));
    const r = await client.image('m', 'p');
    expect(r.ok && r.value.type).toBe('image/png');
  });

  it('image_with_no_image_in_body_is_bad_response', async () => {
    const { client } = make(async () => json({ data: [] }));
    expect(await client.image('m', 'p')).toEqual({ ok: false, reason: 'bad-response' });
  });

  it('maps_401_to_auth_402_to_credit_429_to_rate', async () => {
    for (const [status, reason] of [[401, 'auth'], [402, 'credit'], [429, 'rate']] as const) {
      const { client } = make(async () => json({ error: {} }, status));
      expect(await client.image('m', 'p')).toEqual({ ok: false, reason });
    }
  });

  it('network_error_gives_network_not_throw', async () => {
    const { client } = make(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await client.image('m', 'p')).toEqual({ ok: false, reason: 'network' });
    expect(await client.video('m', 'p')).toEqual({ ok: false, reason: 'network' });
  });

  it('aborted_signal_gives_network', async () => {
    const ac = new AbortController();
    ac.abort();
    const { client } = make(async () => {
      throw new DOMException('aborted', 'AbortError');
    });
    expect(await client.image('m', 'p', ac.signal)).toEqual({ ok: false, reason: 'network' });
    expect(await client.video('m', 'p', ac.signal)).toEqual({ ok: false, reason: 'network' });
  });

  it('no_key_gives_no_key_without_calling_fetch', async () => {
    const { client, fetch } = make(async () => json({}), null);
    expect(await client.image('m', 'p')).toEqual({ ok: false, reason: 'no-key' });
    expect(await client.video('m', 'p')).toEqual({ ok: false, reason: 'no-key' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('openrouter video', () => {
  it('video_submits_then_polls_until_completed_then_downloads', async () => {
    const statuses = ['pending', 'in_progress', 'completed'];
    const { client, fetch, sleep } = make(async (url, init) => {
      if (init?.method === 'POST') return json({ id: 'job1', polling_url: 'https://evil.example/x', status: 'pending' }, 202);
      if (url.includes('/content')) return new Response(new Blob(['mp4bytes'], { type: 'video/mp4' }));
      return json({ id: 'job1', status: statuses.shift() });
    });
    const r = await client.video('google/veo-3.1', 'a flood');
    expect(r.ok).toBe(true);
    if (r.ok) expect(await r.value.text()).toBe('mp4bytes');
    expect(sleep).toHaveBeenCalledTimes(2);
    const urls = fetch.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(urls.every((u) => new URL(u).host === 'openrouter.ai')).toBe(true);
    expect(urls[0]).toBe('https://openrouter.ai/api/v1/videos');
    expect(urls.at(-1)).toContain('/api/v1/videos/job1/content');
    for (const c of fetch.mock.calls as [string, RequestInit][]) {
      expect((c[1].headers as Record<string, string>).Authorization).toBe('Bearer sk-or-secret');
    }
  });

  it('video_failed_job_gives_refused', async () => {
    const { client } = make(async (_u, init) =>
      init?.method === 'POST' ? json({ id: 'j', status: 'pending' }, 202) : json({ id: 'j', status: 'failed', error: 'Content policy violation' }),
    );
    expect(await client.video('m', 'p')).toEqual({ ok: false, reason: 'refused' });
  });

  it('video_poll_gives_timeout_after_limit', async () => {
    const { client, fetch } = make(async (_u, init) =>
      init?.method === 'POST' ? json({ id: 'j', status: 'pending' }, 202) : json({ id: 'j', status: 'in_progress' }),
    );
    expect(await client.video('m', 'p')).toEqual({ ok: false, reason: 'timeout' });
    expect(fetch.mock.calls.length).toBeGreaterThan(5);
    expect(fetch.mock.calls.length).toBeLessThan(200);
  });
});
