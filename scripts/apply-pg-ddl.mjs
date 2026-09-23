#!/usr/bin/env node
/**
 * Applies drizzle-generated Postgres migration file(s) to Neon.
 *
 * Usage (secret never touches disk):
 *   $env:DATABASE_URL = "..."   # PowerShell
 *   node scripts/apply-pg-ddl.mjs cod-server/src/db/migrations-pg/0001_x.sql [0002_y.sql ...]
 *
 * Statements are split on drizzle's `--> statement-breakpoint` marker.
 */
import { readFileSync } from "fs";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Usage: node scripts/apply-pg-ddl.mjs <file.sql> [...]");
  process.exit(1);
}
const sql = neon(url);
for (const file of files) {
  const ddl = readFileSync(file, "utf8");
  const stmts = ddl.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
  for (const s of stmts) {
    await sql.query(s);
    console.log(`[${file}] applied:`, s.slice(0, 70).replace(/\s+/g, " "));
  }
}
console.log("done");
