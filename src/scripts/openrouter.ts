// OpenRouter media client (images + video). Talks to https://openrouter.ai only; the key travels only in
// the Authorization header and is never put in a URL, a body, or a log. Every method resolves, never throws.
//
// Request shapes follow the docs read 2026-10-20:
//   Image:  https://openrouter.ai/docs/guides/overview/multimodal/image-generation
//           POST /api/v1/images {model, prompt} -> {data:[{b64_json, media_type}]}
//   Video:  https://openrouter.ai/docs/guides/overview/multimodal/video-generation
//           (cookbook: https://openrouter.ai/docs/cookbook/video-generation/choose-video-model)
//           POST /api/v1/videos {model, prompt} -> 202 {id, status}; GET /api/v1/videos/{id} until
//           status 'completed' ('failed' carries `error`); GET /api/v1/videos/{id}/content?index=0 -> MP4.
//           Content URLs are unsigned and need the same Authorization header.
// Note: the plan said chat-completions image output; the current docs have a dedicated /images endpoint, which wins.
// Poll/content URLs are rebuilt from the job id, never taken from the response, so the key cannot be sent
// to a host the server named.

export type MediaFailure = 'no-key' | 'auth' | 'credit' | 'rate' | 'refused' | 'network' | 'timeout' | 'bad-response';
export type MediaResult<T> = { ok: true; value: T } | { ok: false; reason: MediaFailure };

export interface OpenRouterDeps {
  fetch: typeof fetch;
  getKey: () => string | null;
  sleep: (ms: number) => Promise<void>;
}

export interface OpenRouterClient {
  image(model: string, prompt: string, signal?: AbortSignal): Promise<MediaResult<Blob>>;
  video(model: string, prompt: string, signal?: AbortSignal): Promise<MediaResult<Blob>>;
}

const BASE = 'https://openrouter.ai/api/v1';
const MAX_POLLS = 60;
const POLL_START_MS = 2000;
const POLL_MAX_MS = 10000;

const fail = (reason: MediaFailure): { ok: false; reason: MediaFailure } => ({ ok: false, reason });

function statusReason(status: number): MediaFailure {
  if (status === 401 || status === 403) return 'auth';
  if (status === 402) return 'credit';
  if (status === 429) return 'rate';
  if (status === 400 || status === 422) return 'refused';
  return 'bad-response';
}

function b64ToBlob(b64: string, type: string): Blob | null {
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
  } catch {
    return null;
  }
}

export function createOpenRouter(deps: OpenRouterDeps): OpenRouterClient {
  async function call(
    path: string,
    key: string,
    signal: AbortSignal | undefined,
    body?: unknown,
  ): Promise<{ ok: true; res: Response } | { ok: false; reason: MediaFailure }> {
    if (signal?.aborted) return fail('network');
    try {
      const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
      const init: RequestInit = { headers, signal };
      if (body !== undefined) {
        init.method = 'POST';
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      const res = await deps.fetch(`${BASE}${path}`, init);
      return res.ok ? { ok: true, res } : fail(statusReason(res.status));
    } catch {
      return fail('network');
    }
  }

  async function readJson(res: Response): Promise<Record<string, unknown> | null> {
    try {
      const v = await res.json();
      return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  return {
    async image(model, prompt, signal) {
      const key = deps.getKey();
      if (!key) return fail('no-key');
      const r = await call('/images', key, signal, { model, prompt });
      if (!r.ok) return r;
      const json = await readJson(r.res);
      const first = (json?.data as Array<Record<string, unknown>> | undefined)?.[0];
      if (!first) return fail('bad-response');
      let blob: Blob | null = null;
      if (typeof first.b64_json === 'string') {
        blob = b64ToBlob(first.b64_json, typeof first.media_type === 'string' ? first.media_type : 'image/png');
      } else if (typeof first.url === 'string') {
        const m = /^data:([^;,]+);base64,(.+)$/.exec(first.url);
        if (m) blob = b64ToBlob(m[2], m[1]);
      }
      return blob ? { ok: true, value: blob } : fail('bad-response');
    },

    async video(model, prompt, signal) {
      const key = deps.getKey();
      if (!key) return fail('no-key');
      const submit = await call('/videos', key, signal, { model, prompt });
      if (!submit.ok) return submit;
      const id = (await readJson(submit.res))?.id;
      if (typeof id !== 'string' || !/^[\w-]+$/.test(id)) return fail('bad-response');

      let wait = POLL_START_MS;
      for (let i = 0; i < MAX_POLLS; i++) {
        const poll = await call(`/videos/${id}`, key, signal);
        if (!poll.ok) return poll;
        const status = (await readJson(poll.res))?.status;
        if (status === 'completed') {
          const dl = await call(`/videos/${id}/content?index=0`, key, signal);
          if (!dl.ok) return dl;
          try {
            return { ok: true, value: await dl.res.blob() };
          } catch {
            return fail('network');
          }
        }
        if (status === 'failed' || status === 'cancelled' || status === 'expired') return fail('refused');
        await deps.sleep(wait);
        wait = Math.min(wait * 1.5, POLL_MAX_MS);
      }
      return fail('timeout');
    },
  };
}
