import { drizzle } from "drizzle-orm/d1";
import type { D1Database } from "@cloudflare/workers-types";
import * as schema from "./schema";
import type { AppDb } from "../../../cod-shared/db/client";

export type { AppDb };

/**
 * Returns the D1-backed database for this request. Every endpoint calls
 * getDb(c.env.DB) — the Workers D1 binding flows straight through.
 */
export function getDb(d1: D1Database): AppDb {
  return drizzle(d1, { schema });
}

/** Test seam: no cache to reset (per-request client). */
export function resetDbCache(): void {}
