/**
 * Minimal ambient globals for the Cloudflare Workers runtime (wrangler sets
 * nodejs_compat, so process.env and Buffer exist at runtime).
 *
 * tsconfig uses "types": [] deliberately (worker purity — no @types/node),
 * so the few Node-isms the shared code relies on are declared here instead
 * of widening global types for the whole program.
 */
declare var process: {
  env: Record<string, string | undefined>;
};

declare const Buffer: {
  from(data: ArrayBuffer | Uint8Array | string): Uint8Array;
};

interface ErrorConstructor {
  captureStackTrace(target: object, constructorOpt?: Function): void;
}
