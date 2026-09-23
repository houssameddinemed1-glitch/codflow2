#!/usr/bin/env node
/**
 * Deploy the storefront to Vercel (project codflow-store).
 *
 * Runtime config is plain Vercel project env — set once in the dashboard
 * (or via `vercel env add`):
 *   STORE_API_KEY  — must match the key_hash seeded into Neon (store_api_keys)
 *   COD_SERVER_URL — deployed cod-server origin (https://codflow-api.vercel.app)
 *   MEDIA_DOMAIN   — optional; unset passes image URLs through unchanged
 *
 * COD_SERVER_URL defaults to http://localhost:8787 so `npm run dev` works out
 * of the box. A deployed storefront can never reach that address, so this
 * script refuses a loopback value unless --force-local is passed.
 *
 * Usage:
 *   npm run deploy
 *   npm run deploy -- --force-local   # intentionally deploy the local value
 */

import { execSync } from "node:child_process";

/** Loopback hosts a deployed storefront can never reach. */
function isLoopbackUrl(value) {
  let hostname;
  try {
    ({ hostname } = new URL(value));
  } catch {
    return false; // not a URL — let the build/runtime report it
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

const forceLocal = process.argv.includes("--force-local");
const serverUrl = process.env.COD_SERVER_URL ?? "http://localhost:8787";

if (isLoopbackUrl(serverUrl) && !forceLocal) {
  console.error(`
Error: COD_SERVER_URL resolves to a local address (${serverUrl}).

A deployed storefront cannot reach your machine, so this would ship a
storefront whose every API call fails.

Set the deployed cod-server origin as a Vercel project env var:

  vercel env add COD_SERVER_URL production

Then re-run:

  npm run deploy

To deploy the local value anyway (rarely what you want):

  npm run deploy -- --force-local
`);
  process.exit(1);
}

if (forceLocal && isLoopbackUrl(serverUrl)) {
  console.warn(`Warning: deploying with a local COD_SERVER_URL (${serverUrl}) — --force-local was passed.`);
}

execSync("vercel deploy --prod", { stdio: "inherit" });
