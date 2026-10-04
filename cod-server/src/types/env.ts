/**
 * Cloudflare Workers runtime environment.
 *
 * Bindings come from wrangler.toml ([[d1_databases]], [[kv_namespaces]],
 * [[r2_buckets]], [images]) and [vars]; secrets via `wrangler secret put`.
 * Handlers read everything through `c.env` — no process.env on Workers.
 */
import type { D1Database, KVNamespace, R2Bucket } from "@cloudflare/workers-types";
import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface Env {
  /** Deployment environment: "development" | "production" */
  ENVIRONMENT: string;
  /** D1 database binding (ecom-master-db) */
  DB: D1Database;
  /** Rate-limit / session KV namespace */
  RATE_LIMIT: KVNamespace;
  /** OAuth + MCP grant-marker KV namespace */
  OAUTH_KV: KVNamespace;
  /** MCP OAuth provider helpers (workers-oauth-provider binding) */
  OAUTH_PROVIDER?: OAuthHelpers;
  /** R2 bucket for product/landing images */
  IMAGES: R2Bucket;
  /** Cloudflare Images binding (write-time WebP transcode) */
  IMAGE_TRANSFORM?: unknown;
  /** Public origin of this API (used for docs links, callbacks, queue URLs) */
  WORKER_URL?: string;
  /** Canonical self origin (JWT audience checks, QStash callbacks) */
  WORKER_SELF_URL?: string;
  /** R2 custom domain serving images, e.g. media.yourdomain.com */
  MEDIA_DOMAIN?: string;
  /** R2 bucket name (for S3-API presign flows) */
  R2_BUCKET_NAME?: string;
  /** R2 S3-API credentials (presigned browser uploads) */
  CF_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  /** Comma-separated list of allowed CORS origins */
  ALLOWED_ORIGINS?: string;
  /** Optional storefront fallback origin for landing page share URLs */
  STOREFRONT_URL?: string;
  /** Dashboard auth origin (JWT issuer verification) */
  BETTER_AUTH_URL?: string;
  /** Shared secret for the internal cron route */
  CRON_SECRET?: string;
  /** QStash token for background publishes (fail-open when absent) */
  QSTASH_TOKEN?: string;
  /** QStash signing keys for inbound callback verification */
  QSTASH_CURRENT_SIGNING_KEY?: string;
  QSTASH_NEXT_SIGNING_KEY?: string;
  /** HMAC secret for MCP login tickets (must match the dashboard) */
  MCP_LOGIN_TICKET_SECRET?: string;
}

/**
 * Vercel/Node entry shim — builds the vars subset of Env from process.env.
 * Used only by api/index.ts (Vercel runtime, being decommissioned).
 * Bindings stay undefined there; cast keeps the old entry compiling.
 */
export function buildEnv(): Env {
  const pick = (name: string): string | undefined => {
    const v = process.env[name];
    return v && v.length > 0 ? v : undefined;
  };
  return {
    ENVIRONMENT: process.env.ENVIRONMENT ?? "development",
    WORKER_URL: pick("WORKER_URL"),
    WORKER_SELF_URL: pick("WORKER_SELF_URL"),
    MEDIA_DOMAIN: pick("MEDIA_DOMAIN"),
    ALLOWED_ORIGINS: pick("ALLOWED_ORIGINS"),
    STOREFRONT_URL: pick("STOREFRONT_URL"),
    BETTER_AUTH_URL: pick("BETTER_AUTH_URL"),
    CRON_SECRET: pick("CRON_SECRET"),
    QSTASH_TOKEN: pick("QSTASH_TOKEN"),
  } as Env;
}
