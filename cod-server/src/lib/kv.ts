import { Redis } from "@upstash/redis";

/**
 * Minimal KV surface used across cod-server (OTP guards, MCP rate limit,
 * grant markers). Mirrors the Cloudflare KVNamespace calls we relied on so
 * call sites stay unchanged — only the backing store moved to Upstash Redis
 * (Vercel KV).
 */
export interface KVLike {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    opts?: { expiration?: number; expirationTtl?: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

class UpstashKV implements KVLike {
  private client: Redis;

  constructor(url: string, token: string) {
    this.client = new Redis({ url, token });
  }

  async get(key: string): Promise<string | null> {
    return this.client.get<string>(key);
  }

  async put(
    key: string,
    value: string,
    opts?: { expiration?: number; expirationTtl?: number },
  ): Promise<void> {
    let ex: number | undefined;
    if (opts?.expirationTtl !== undefined) {
      ex = opts.expirationTtl;
    } else if (opts?.expiration !== undefined) {
      ex = Math.max(1, opts.expiration - Math.floor(Date.now() / 1000));
    }
    if (ex !== undefined) {
      await this.client.set(key, value, { ex });
    } else {
      await this.client.set(key, value);
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }
}

let cached: KVLike | null = null;
let resolved = false;

/**
 * Shared rate-limit/session KV. Returns undefined when unconfigured —
 * every caller already treats that as "no local guard" (fail-open).
 * Reads Vercel's injected Upstash variables.
 */
export function kvFromEnv(): KVLike | undefined {
  if (!resolved) {
    resolved = true;
    const url = process.env.KV_REST_API_URL;
    const token = process.env.KV_REST_API_TOKEN;
    cached = url && token ? new UpstashKV(url, token) : null;
  }
  return cached ?? undefined;
}

/** Test seam: reset the cached client between tests. */
export function resetKvCache(): void {
  cached = null;
  resolved = false;
}
