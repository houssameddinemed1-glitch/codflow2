# theme01 — CodFlow Storefront

The default storefront theme for CodFlow: a mobile-first, multi-locale,
conversion-focused **Astro 7** storefront that talks to the CodFlow backend
(`cod-server`) over the public `/store/*` API.

theme01 is part of the [CodFlow monorepo](../../README.md). It is one of three
Workers that make up the platform:

| Worker | Role |
|--------|------|
| `cod-server` | Backend engine — REST API, `/store/*` storefront API, webhooks, MCP |
| `cod-client-astro` | Merchant dashboard (Astro) |
| `cod-astro/theme01` | **Storefront — this package** |

## What it does

- Product catalog: home, listing, category, and product-detail pages
- COD order form with a wilaya-based shipping calculator, variant + offer support
- Product reviews (submitted and read through `cod-server`)
- Abandoned-order tracking (`POST /store/abandoned`) with the Meta Pixel
- Three locale packs: **Arabic, French, English** (RTL-first, default Arabic)
- Partner-overridable design tokens (colors, font) injected at request time
- Cloudflare Image Resizing optimization for Blob images (`MEDIA_DOMAIN`)

## Quick start

Prereqs: Node 22.12+, the [Vercel CLI](https://vercel.com/docs/cli),
and a running `cod-server` (the storefront reads all data from its `/store/*` API).

```bash
npm ci                           # at the repo root — installs all workspaces
cd cod-astro/theme01
cp .dev.vars.example .dev.vars   # fill in your values
npm run dev                      # http://localhost:4321
```

> The storefront expects `cod-server` to be running on `http://localhost:8787`
> (the default `COD_SERVER_URL`). See the [monorepo README](../../README.md#getting-started)
> to bring up the backend and seed a demo store.

## Environment variables

Defined in `astro.config.mjs` → `env.schema`, read from `.dev.vars` locally and
Vercel project env in production (`vercel env add`).

| Variable | Required | Purpose |
|----------|----------|---------|
| `STORE_API_KEY` | yes | Per-store key sent as `X-Store-API-Key` to the `/store/*` API. Must match the key seeded into Neon (`store_api_keys`). |
| `COD_SERVER_URL` | yes | Base URL of the `cod-server` API (dev: `http://localhost:8787`, prod: `https://codflow-api.vercel.app`). |
| `MEDIA_DOMAIN` | no | Media/CDN domain serving Blob images (no scheme). Unset → the image optimizer passes original URLs through unchanged. |

## Scripts

| Script | What it does |
|--------|--------------|
| `npm run dev` | Astro dev server on `http://localhost:4321` |
| `npm run build` | Production build (`astro build`) |
| `npm run preview` | Build, then preview locally (`astro preview`) |
| `npm run deploy` | Deploy to Vercel (`vercel deploy --prod`) |
| `npm test` | Vitest unit/property tests (`fast-check`) |
| `npm run validate:strings` | Check for hardcoded user-facing strings in components |
| `npm run validate:styles` | Check for hardcoded colors/radii/fonts in component styles |
| `npm run validate:all` | Both validators, then `astro build` |

## Project structure

```
src/
├── core/                # Platform-owned engine — DO NOT MODIFY
│   ├── actions/         #   placeOrder action (Zod validation + API call)
│   ├── api/             #   client.ts, types.ts, validation.ts
│   ├── data/            #   wilayas.ts (58 wilayas)
│   ├── endpoints/       #   communes, product-reviews, submit-review
│   ├── middleware.ts    #   POST/Redirect/GET handler for Astro actions
│   └── utils/           #   image-optimizer.ts (Cloudflare Image Resizing)
├── theme/               # Theme layer — everything customizable
│   ├── components/      #   home/, layout/, order/, product/, products/, category/, ui/
│   ├── content/         #   types.ts + ar.ts / fr.ts / en.ts (all UI strings)
│   ├── config/          #   store.ts (DEFAULT_CONFIG + getStoreContext)
│   ├── layouts/         #   StoreLayout.astro
│   ├── scripts/         #   product.ts, track-abandonment.ts (+ property tests)
│   ├── styles/          #   global.css (design tokens)
│   └── utils/           #   seo.ts
├── actions/             # Proxy → re-exports src/core/actions
├── middleware.ts        # Proxy → re-exports src/core/middleware
├── content.config.ts    # Build-time collections (empty — data is fetched at request time)
└── pages/               # index, products/, category/, thank-you, api/*
```

See [THEME_GUIDE.md](./THEME_GUIDE.md) for the two hard rules (no hardcoded
strings, no hardcoded design tokens), the design system, and the full component
inventory.

## Deployment

```bash
cd cod-astro/theme01
vercel env add STORE_API_KEY production     # the key your backend issues
vercel env add COD_SERVER_URL production    # your deployed backend URL
# optional:
vercel env add MEDIA_DOMAIN production      # media.yourdomain.com
npm run deploy
```

Never put real secrets in `wrangler.jsonc` (kept only as a local-dev reference).

## Documentation

- **[`THEME_GUIDE.md`](./THEME_GUIDE.md)** — design system, hard rules, component
  inventory, production gotchas, contributor briefing
- **[`CONTENT_KEYS_REFERENCE.md`](./CONTENT_KEYS_REFERENCE.md)** — all storefront
  content keys (155) grouped by section
- **[`src/core/README.md`](./src/core/README.md)** — the platform-owned engine
- **[`src/theme/README.md`](./src/theme/README.md)** — customizing the theme layer
- **[`lighthouse-tests/README.md`](./lighthouse-tests/README.md)** — optional
  Lighthouse performance/accessibility suite