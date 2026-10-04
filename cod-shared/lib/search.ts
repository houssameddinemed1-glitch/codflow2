import { like, sql, type SQL } from "drizzle-orm";
import type { Column } from "drizzle-orm";

/**
 * Case-insensitive LIKE that runs on both Postgres (ILIKE) and SQLite.
 * SQLite has no ILIKE operator, so fold both sides with lower(). Arabic is
 * caseless (identical either way); French accents fold ASCII-insensitively,
 * matching ILIKE for the merchant's Latin-alphabet searches.
 */
export function ilikeFold(column: Column | SQL, pattern: string) {
  return like(sql`lower(${column})`, pattern.toLowerCase());
}
