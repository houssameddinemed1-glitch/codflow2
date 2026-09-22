import { getPgDb, type PgDb } from "../../../cod-shared/db/client.pg";

export type { PgDb };
/**
 * Historical alias: endpoint code was written against `AppDb` (D1). On the
 * Vercel stack it is the Postgres database — same name, new engine.
 */
export type AppDb = PgDb;

let cached: PgDb | null = null;

/**
 * Returns the shared Postgres client. The optional argument preserves every
 * existing `getDb(c.env.DB)` call site — the D1 handle is simply ignored.
 */
export function getDb(_d1?: unknown): PgDb {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set — connect Vercel Postgres (or set it locally)");
    }
    cached = getPgDb(url);
  }
  return cached;
}

/** Test seam: reset the cached client between tests. */
export function resetDbCache(): void {
  cached = null;
}
