/**
 * Vercel runtime environment.
 *
 * Plain process-env values (injected by Vercel project settings). The shape
 * deliberately mirrors the old Worker bindings where handlers read them, so
 * `c.env.X` call sites keep working — the entry builds this object from
 * process.env on every request.
 */
export interface Env {
  /** Deployment environment: "development" | "production" */
  ENVIRONMENT: string;
  /** Postgres database URL (read by getDb() via process.env; this field is a no-op stub so c.env.DB compiles) */
  DB?: string;
  /** Public origin of this API (used for docs links, callbacks, queue URLs) */
  WORKER_URL?: string;
  /** Canonical self origin (JWT audience checks, QStash callbacks) */
  WORKER_SELF_URL?: string;
  /** Blob-backed image serving is URL-direct; kept for reference only */
  MEDIA_DOMAIN?: string;
  /** Comma-separated list of allowed CORS origins */
  ALLOWED_ORIGINS?: string;
  /** Optional storefront fallback origin for landing page share URLs */
  STOREFRONT_URL?: string;
  /** Dashboard auth origin (JWT issuer verification) */
  BETTER_AUTH_URL?: string;
  /** Shared secret for the internal cron route (Vercel Cron / QStash schedules) */
  CRON_SECRET?: string;

  // ─── Legacy CF stubs (no-ops, kept so `Pick<Env, ...>` in landing-pages
  //     ai-tools compiles — guards already treat these as absent on Vercel). ───
  IMAGES?: { put: (...a: any[]) => Promise<any>; get: (...a: any[]) => Promise<any>; delete: (...a: any[]) => Promise<any> };
  LP_IMAGE_UPLOAD_WORKFLOW?: { create: (...a: any[]) => Promise<any>; get: (...a: any[]) => Promise<any> };
  CAPI_WORKFLOW?: { create: (...a: any[]) => Promise<any> };
  TIKTOK_WORKFLOW?: { create: (...a: any[]) => Promise<any> };
}

function pick(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

/** Build the request env from process.env. Called once per invocation. */
export function buildEnv(): Env {
  return {
    ENVIRONMENT: process.env.ENVIRONMENT ?? "development",
    WORKER_URL: pick("WORKER_URL"),
    WORKER_SELF_URL: pick("WORKER_SELF_URL"),
    MEDIA_DOMAIN: pick("MEDIA_DOMAIN"),
    ALLOWED_ORIGINS: pick("ALLOWED_ORIGINS"),
    STOREFRONT_URL: pick("STOREFRONT_URL"),
    BETTER_AUTH_URL: pick("BETTER_AUTH_URL"),
    CRON_SECRET: pick("CRON_SECRET"),
  };
}
