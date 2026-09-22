#!/usr/bin/env node
/**
 * Deploy the storefront worker with COD_SERVER_URL injected from the unified
 * root .env (COD_SERVER_URL) — see cod-server/scripts/cloud-env.mjs.
 * STORE_API_KEY is a worker secret, set separately via `wrangler secret put`.
 *
 * COD_SERVER_URL defaults to http://localhost:8787 so `npm run dev` works out
 * of the box. A deployed Worker can never reach that address, so shipping it
 * produces a storefront whose every API call fails. Deployment is refused when
 * the value resolves to localhost unless --force-local is passed.
 *
 * Usage:
 *   npm run deploy
 *   npm run deploy -- --force-local   # intentionally deploy the local value
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getCloudEnv } from "../../../cod-server/scripts/cloud-env.mjs";

const forceLocal = process.argv.includes("--force-local");
const { serverUrl } = getCloudEnv();
const themeDir = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Loopback hosts a deployed Worker can never reach. */
function isLoopbackUrl(value) {
  let hostname;
  try {
    ({ hostname } = new URL(value));
  } catch {
    return false; // not a URL — let wrangler report it
  }
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "[::1]" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost")
  );
}

if (isLoopbackUrl(serverUrl) && !forceLocal) {
  console.error(`
Error: COD_SERVER_URL resolves to a local address (${serverUrl}).

A deployed Worker cannot reach your machine, so this would ship a storefront
whose every API call fails.

Set the deployed cod-server origin in <repo-root>/.env:

  COD_SERVER_URL=https://api.yourdomain.com

See <repo-root>/.env.example for the full template, then re-run:

  npm run deploy

To deploy the local value anyway (rarely what you want):

  npm run deploy -- --force-local
`);
  process.exit(1);
}

if (forceLocal && isLoopbackUrl(serverUrl)) {
  console.warn(`Warning: deploying with a local COD_SERVER_URL (${serverUrl}) — --force-local was passed.`);
}

// Worker-to-worker fetch over *.workers.dev is blocked by Cloudflare (1042),
// so the storefront calls cod-server through a service binding. The binding
// target is install-specific, so it is injected here at deploy time from
// cod-server/wrangler.toml — never committed to wrangler.jsonc.
const serverToml = readFileSync(join(themeDir, "..", "..", "cod-server", "wrangler.toml"), "utf8");
const serverName = serverToml.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
if (!serverName) {
  console.error("Error: could not read worker name from cod-server/wrangler.toml.");
  process.exit(1);
}
const configPath = join(themeDir, "wrangler.jsonc");
const baseJsonc = readFileSync(configPath, "utf8");
// Swap the services binding into wrangler.jsonc in place (a separate
// --config file breaks the adapter's entry-point resolution), then restore.
const mergedJsonc = baseJsonc.replace(
  /"observability":\s*\{\s*"enabled":\s*true\s*\}/,
  `"observability": { "enabled": true }, "services": [ { "binding": "COD_SERVER", "service": "${serverName}" } ]`
);
if (mergedJsonc === baseJsonc) {
  console.error("Error: could not inject services binding into wrangler.jsonc.");
  process.exit(1);
}
writeFileSync(configPath, mergedJsonc);
try {
  execSync("npm run build", { stdio: "inherit", cwd: themeDir });
  execSync(`npx wrangler deploy --var COD_SERVER_URL:${serverUrl}`, {
    stdio: "inherit",
    cwd: themeDir,
  });
} finally {
  writeFileSync(configPath, baseJsonc);
}
