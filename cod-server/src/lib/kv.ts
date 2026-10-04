import { Redis } from "@upstash/redis";
import type { KVNamespace } from "@cloudflare/workers-types";

/**
 * Minimal KV surface used across cod-server (OTP guards, MCP rate limit,
 * grant markers). Mirrors Cloudflare KVNamespace calls so call sites stay
 * unchanged across runtimes — only the backing store differs.
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
 * Shared rate-limit/session KV. Pass the request's KV binding on Workers
 * (OTP → RATE_LIMIT, MCP → OAUTH_KV); a Cloudflare KVNamespace already
 * satisfies KVLike (get/put/delete with the same option keys), so it is
 * used directly. Without a binding it falls back to Upstash (Vercel/local).
 * Returns undefined when unconfigured — every caller already treats that as
 * "no local guard" (fail-open).
 */
export function kvFromEnv(binding?: KVNamespace | KVLike): KVLike | undefined {
  if (binding) return binding as unknown as KVLike;
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
