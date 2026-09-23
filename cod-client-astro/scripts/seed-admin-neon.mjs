#!/usr/bin/env node
/**
 * Seed the admin user into Neon Postgres.
 *
 * Usage (run from cod-client-astro/):
 *   $env:DATABASE_URL="..."                         # PowerShell
 *   ADMIN_EMAIL=you@example.com ADMIN_NAME=You node scripts/seed-admin-neon.mjs [password]
 *
 * The admin email/name come from $ADMIN_EMAIL / $ADMIN_NAME (defaults to
 * admin@example.com / Admin).
 *
 * Idempotent: re-running refreshes the password + api_key for the same email
 * (both are shown every run — save them).
 *
 * Uses the same scrypt params as @better-auth/utils/password so the hash
 * is verifiable by better-auth at runtime.
 */

import { scrypt, randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { neon } from "@neondatabase/serverless";

const scryptAsync = promisify(scrypt);

// Must match @better-auth/utils/password config exactly
const SCRYPT = { N: 16384, r: 16, p: 1, dkLen: 64 };

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await scryptAsync(
    password.normalize("NFKC"),
    salt,
    SCRYPT.dkLen,
    { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 128 * SCRYPT.N * SCRYPT.r * 2 }
  );
  return `${salt}:${key.toString("hex")}`;
}

function uid() {
  return randomBytes(16).toString("hex");
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set — pull it (vercel env pull) or export it first.");
    process.exit(1);
  }
  const passwordArg = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const password = passwordArg ?? randomBytes(12).toString("base64url");

  const email = process.env.ADMIN_EMAIL ?? "admin@example.com";
  const name  = process.env.ADMIN_NAME ?? "Admin";

  const userId    = uid();
  const accountId = uid();
  const apiKey    = `cod_${randomBytes(16).toString("hex")}`;
  const hashedPw  = await hashPassword(password);

  const sql = neon(url);

  // Credential accounts match Better Auth >= 1.7 lookup semantics:
  // provider_id = 'credential', issuer = 'local:credential',
  // account_id = user id (NOT the email).
  // Tagged-template form works on both @neondatabase/serverless 0.x and 1.x
  // (the dashboard has a nested 0.10 copy whose client has no .query method).
  await sql`
    INSERT INTO users (id, name, email, email_verified, role, status, api_key, language)
    VALUES (${userId}, ${name}, ${email}, true, 'admin', 'active', ${apiKey}, 'en')
    ON CONFLICT (email) DO UPDATE SET api_key = EXCLUDED.api_key, updated_at = now()`;
  const users = await sql`SELECT id FROM users WHERE email = ${email}`;
  const dbUserId = users[0].id;

  await sql`
    INSERT INTO accounts (id, user_id, account_id, provider_id, issuer, password)
    SELECT ${accountId}, u.id, u.id, 'credential', 'local:credential', ${hashedPw} FROM users u
    WHERE u.email = ${email}
    ON CONFLICT DO NOTHING`;
  await sql`
    UPDATE accounts SET password = ${hashedPw}, issuer = 'local:credential', account_id = user_id, updated_at = now()
    WHERE user_id = ${dbUserId} AND provider_id = 'credential'`;

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║                 Admin user seeded (Neon)                ║");
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log(`║  Email    : ${email.padEnd(44)} ║`);
  console.log(`║  Password : ${password.padEnd(44)} ║`);
  console.log(`║  API Key  : ${apiKey.padEnd(44)} ║`);
  console.log(`║  Role     : admin                                        ║`);
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log("\nSave these credentials — they won't be shown again.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
