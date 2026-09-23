#!/usr/bin/env node
// One-off Neon check: prints row count of a table. Usage:
//   $env:DATABASE_URL="..."; node scripts/check-table.mjs lp_image_upload_jobs
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const table = process.argv[2];
if (!/^[a-z_]+$/.test(table ?? "")) {
  console.error("Usage: node scripts/check-table.mjs <table>");
  process.exit(1);
}
const sql = neon(url);
const rows = await sql.query(`select count(*)::int as n from ${table}`);
console.log(`${table} rows:`, rows[0].n);
