import type { AppDb } from "../db/client";

/**
 * Atomic multi-statement write for D1 (Cloudflare Workers have no
 * interactive transactions — db.batch executes as a single transaction).
 *
 * Accepts any list of insert/update/delete builders, however narrowed by
 * inference; the single cast below is the only `any` in the batch path.
 * No-op on an empty list (D1 rejects empty batches). Reads must be hoisted
 * BEFORE the call — nothing inside executes until the single round trip.
 */
export async function batchAll(db: AppDb, stmts: readonly unknown[]): Promise<void> {
  if (stmts.length === 0) return;
  await db.batch(stmts as [any, ...any[]]);
}
