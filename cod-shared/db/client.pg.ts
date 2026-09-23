import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool, neonConfig } from "@neondatabase/serverless";
import * as schema from "./schema.pg";

// Endpoint discovery cache — recommended for serverless environments.
neonConfig.fetchConnectionCache = true;

const poolCache = new Map<string, Pool>();

function getPool(connectionString: string): Pool {
  let pool = poolCache.get(connectionString);
  if (!pool) {
    pool = new Pool({ connectionString });
    poolCache.set(connectionString, pool);
  }
  return pool;
}

/**
 * Shared Postgres client (Neon WebSocket pool).
 *
 * A pooled driver is required — neon-http has no transaction support and
 * order placement, stock moves, and variant writes all run inside
 * db.transaction() for atomicity.
 */
export function getPgDb(connectionString: string) {
  return drizzle(getPool(connectionString), { schema });
}

export type PgDb = ReturnType<typeof getPgDb>;
