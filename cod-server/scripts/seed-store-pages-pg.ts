#!/usr/bin/env -S npx tsx
/**
 * Seeds a store's four legal pages (Terms, Privacy, Refund, Shipping).
 *
 * Neon/Postgres port of the upstream D1 seeder: a THIN wrapper around the
 * shared `seedStorePages` query (the same code the app uses at runtime), so
 * the seed can never drift from what provisioning writes. Idempotent per
 * store — running twice creates nothing new.
 *
 * The DATABASE_URL secret never touches disk: pass it in the environment.
 *
 * Usage (from cod-server/):
 *   $env:DATABASE_URL = "..."; npx tsx scripts/seed-store-pages-pg.ts --store-id=store-abc123
 */
import { getPgDb } from "../../cod-shared/db/client.pg";
import { seedStorePages } from "../../cod-shared/queries/store-pages";

const args = process.argv.slice(2);
const storeIdArg = args.find((a) => a.startsWith("--store-id="));
const storeId = storeIdArg ? storeIdArg.slice("--store-id=".length) : "store-local-dev";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[seed-store-pages] DATABASE_URL is not set");
  process.exit(1);
}

const db = getPgDb(url);
const { created } = await seedStorePages(db, storeId);
console.log(
  `[seed-store-pages] store "${storeId}": created ${created.length} page(s)${created.length > 0 ? ` (${created.join(", ")})` : ""}`
);
process.exit(0);
