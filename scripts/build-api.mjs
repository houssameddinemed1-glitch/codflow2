#!/usr/bin/env node
/**
 * Bundle the cod-server Hono app into a single ESM file for Vercel.
 * Outputs to api/index.js — Vercel auto-discovers api/*.js as serverless
 * functions (.mjs is NOT discovered). api/package.json marks it as ESM.
 *
 * NOTE: lives in scripts/ (not api/) so Vercel never treats the builder
 * itself as a serverless function.
 */
import { build } from "esbuild";
import { mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const outDir = resolve(root, "api");

mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [resolve(root, "cod-server/api/index.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: resolve(outDir, "index.js"),
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  alias: {
    "@": resolve(root, "cod-server/src"),
  },
  external: [
    "node:*",
    "@neondatabase/serverless",
    "@upstash/redis",
    "@upstash/qstash",
    "@vercel/blob",
  ],
  target: "node22",
  sourcemap: false,
  minify: false,
});

console.log("✓ Bundled api/index.js");
