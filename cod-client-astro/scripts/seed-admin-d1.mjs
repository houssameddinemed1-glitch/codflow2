#!/usr/bin/env node
/**
 * Seed the admin user into Cloudflare D1 (shared cod-server database).
 *
 * Cloudflare-only replacement for seed-admin-neon.mjs (Neon Postgres,
 * Vercel-stack). Theme01 stays on Vercel; everything else runs on Workers.
 *
 * Usage (run from cod-client-astro/):
 *   npm run db:migrate --prefix ../cod-server  # tables must exist first
 *   ADMIN_EMAIL=you@example.com ADMIN_NAME=You node scripts/seed-admin-d1.mjs [password]
 *   node scripts/seed-admin-d1.mjs --remote [password]  # remote D1
 *
 * Idempotent: re-running refreshes the password + api_key for the same email
 * (both are shown every run — save them).
 *
 * Uses the same scrypt params as @better-auth/utils/password so the hash
 * is verifiable by better-auth at runtime. Matches migrations 0010/0011:
 * provider_id = 'credential', issuer = 'local:credential',
 * account_id = user id (NOT the email).
 */

import { scrypt, randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scryptAsync = promisify(scrypt);

// Must match @better-auth/utils/password config exactly
const SCRYPT = { N: 16384, r: 16, p: 1, dkLen: 64 };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dashRoot = path.resolve(__dirname, "..");
const serverScripts = path.resolve(dashRoot, "../cod-server/scripts");

const remote = process.argv.includes("--remote");

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await scryptAsync(
    password.normalize("NFKC"),
    salt,
    SCRYPT.dkLen,
    { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 128 * SCRYPT.N * SCRYPT.r * 2 },
  );
  return `${salt}:${key.toString("hex")}`;
}

function uid() {
  return randomBytes(16).toString("hex");
}

function esc(s) {
  return s.replace(/'/g, "''");
}

function getDbName() {
  try {
    const mod = process.env.COD_DB_NAME;
    if (mod) return mod;
  } catch { /* ignore */ }
  try {
    // Read root .env without extra deps (precedence: process.env > .env).
    const fs = process.argv ? null : null;
    void fs;
  } catch { /* ignore */ }
  return "ecom-master-db";
}

async function loadCloudEnv() {
  try {
    const m = await import(path.resolve(serverScripts, "cloud-env.mjs"));
    return m.getCloudEnv ? m.getCloudEnv() : { dbName: getDbName() };
  } catch {
    return { dbName: process.env.COD_DB_NAME ?? "ecom-master-db" };
  }
}

function run(sql, dbName) {
  // Dashboard astro dev keeps its own replica under .wrangler/state (separate
  // from the server's ../.wrangler-shared). Override with PERSIST_TO when
  // seeding that replica; only auth tables (users/accounts) matter there —
  // business data flows through PUBLIC_API_URL.
  const persist = process.env.PERSIST_TO ?? "../.wrangler-shared";
  const target = remote ? "--remote" : `--local --persist-to ${persist}`;
  const out = execSync(
    `npx wrangler d1 execute ${dbName} ${target} --command "${sql.replace(/"/g, '\\"')}" --json`,
    { cwd: dashRoot, stdio: "pipe", encoding: "utf8" },
  );
  try {
    return JSON.parse(out);
  } catch {
    return out;
  }
}

function firstRow(res) {
  try {
    const r = Array.isArray(res) ? res[0] : res;
    const rows = r?.results ?? r?.rows ?? [];
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

async function main() {
  const { dbName } = await loadCloudEnv();
  const passwordArg = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const password = passwordArg ?? randomBytes(12).toString("base64url");

  const email = process.env.ADMIN_EMAIL ?? "admin@example.com";
  const name = process.env.ADMIN_NAME ?? "Admin";

  const userId = uid();
  const accountId = uid();
  const apiKey = `cod_${randomBytes(16).toString("hex")}`;
  const hashedPw = await hashPassword(password);
  const now = Date.now();

  // D1 timestamps are integer ms (unixepoch ms); booleans are 0/1.
  run(
    `INSERT INTO users (id, name, email, email_verified, role, status, api_key, language, created_at, updated_at) ` +
    `VALUES ('${userId}', '${esc(name)}', '${esc(email)}', 1, 'admin', 'active', '${apiKey}', 'en', ${now}, ${now}) ` +
    `ON CONFLICT(email) DO UPDATE SET api_key=excluded.api_key, updated_at=${now}`,
    dbName,
  );
  const row = firstRow(run(`SELECT id FROM users WHERE email='${esc(email)}'`, dbName));
  const dbUserId = row?.id ?? row?.ID ?? userId;

  run(
    `INSERT INTO accounts (id, user_id, account_id, provider_id, issuer, password, created_at, updated_at) ` +
    `SELECT '${accountId}', u.id, u.id, 'credential', 'local:credential', '${hashedPw}', ${now}, ${now} FROM users u ` +
    `WHERE u.email='${esc(email)}' ON CONFLICT DO NOTHING`,
    dbName,
  );
  run(
    `UPDATE accounts SET password='${hashedPw}', issuer='local:credential', account_id=user_id, updated_at=${now} ` +
    `WHERE user_id='${esc(String(dbUserId))}' AND provider_id='credential'`,
    dbName,
  );

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║                 Admin user seeded (D1)                  ║");
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log(`║  Email    : ${email.padEnd(44)} ║`);
  console.log(`║  Password : ${password.padEnd(44)} ║`);
  console.log(`║  API Key  : ${apiKey.padEnd(44)} ║`);
  console.log("║  Role     : admin                                        ║");
  console.log(`║  Target   : ${(remote ? `remote D1 (${dbName})` : `local D1 (${process.env.PERSIST_TO ?? "../.wrangler-shared"})`).padEnd(44)} ║`);
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log("\nSave these credentials — they won't be shown again.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
