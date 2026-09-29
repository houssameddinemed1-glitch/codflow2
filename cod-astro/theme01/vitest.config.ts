/**
 * Vitest config.
 *
 * Uses Astro's `getViteConfig` so `.astro` components can be imported and
 * rendered through the Container API (`astro/container`). That is what lets
 * ProductInfo's description branch — sanitised HTML vs escaped text — be tested
 * against the real component instead of a hand-written stand-in.
 *
 * `environment: "happy-dom"` is kept for the DOM-based script tests. Tests that
 * render an `.astro` component must opt into node with a
 * `// @vitest-environment node` docblock: under happy-dom the Astro plugin
 * resolves `.astro` imports to the browser stub, which throws.
 */
/// <reference types="vitest/config" />
import { getViteConfig } from "astro/config";
import path from "node:path";

export default getViteConfig({
  resolve: {
    alias: {
      // The real package ships TS source that Node refuses to type-strip from
      // node_modules — stub it in tests only; production is untouched.
      "@vercel/analytics/astro": path.resolve(
        import.meta.dirname,
        "./src/test-utils/vercel-analytics-stub.astro",
      ),
    },
  },
  test: {
    environment: "happy-dom",
    globals: true,
  },
});
