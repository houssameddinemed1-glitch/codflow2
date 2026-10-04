/**
 * Landing Pages Queries
 *
 * Centralized database operations for landing pages: the one-product
 * marketing pages (image stack + COD form). Stats (views/orders/revenue)
 * join orders by attribution; the conversion rate is computed by the caller
 * because a zero-view page has an undefined rate, not zero.
 */
import { eq, desc, and, sql, isNull, count } from "drizzle-orm";
import {
  landingPages,
  landingPageImages,
  landingPagePixelConfig,
  landingPageProducts,
  lpImageUploadJobs,
  orders,
  products,
  stores,
} from "../db/schema";
import type { AppDb } from "../db/client";

export interface LandingPageStats {
  views: number;
  orders: number;
  revenue: number;
}

export interface LandingPageListItem {
  id: string;
  slug: string;
  name: string;
  status: "draft" | "published" | "archived";
  productId: string;
  productName: string | null;
  productHandle: string | null;
  imageCount: number;
  views: number;
  orders: number;
  revenue: number;
  /** The page's own tracking, when it has one. Never carries the token. */
  tracking: {
    pixelId: string;
    conversionEvent: "Lead" | "Purchase" | "Purchase_Confirmed" | "Purchase_Delivered";
    enabled: boolean;
    testMode: boolean;
  } | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLandingPageData {
  name: string;
  slug?: string;
  productId: string;
  kind?: "single" | "multi";
  /** Initial picks for a multi page — ordered, first doubles as the cover product. */
  productIds?: string[];
  imageGap?: number;
  metaTitle?: string | null;
  metaDescription?: string | null;
}

export interface UpdateLandingPageData {
  name?: string;
  slug?: string;
  imageGap?: number;
  metaTitle?: string | null;
  metaDescription?: string | null;
}

export interface LandingPageImageInput {
  r2Key: string;
  src: string;
  altText?: string | null;
  position?: number;
  /** Intrinsic pixel size — reserved by the storefront to prevent CLS. */
  width?: number | null;
  height?: number | null;
  /** Provenance of the upload — AI agents set "ai", browser uploads default to "upload". */
  source?: "upload" | "ai";
}

const STATS_SELECT = {
  orders: sql<number>`(
    SELECT COUNT(*) FROM orders
    WHERE orders.landing_page_id = landing_pages.id
  )`,
  revenue: sql<number>`(
    SELECT COALESCE(SUM(orders.price), 0) FROM orders
    WHERE orders.landing_page_id = landing_pages.id
  )`,
};

/** Opt-in pagination — applied only when provided; omitted means unbounded
 *  (the dashboard list fetches everything). */
export interface LandingPageListPagination {
  limit?: number;
  offset?: number;
}

async function resolveListRow(
  db: AppDb,
  filters: { productId?: string; status?: "draft" | "published" | "archived" } = {},
  pagination: LandingPageListPagination = {},
): Promise<LandingPageListItem[]> {
  // Filters belong in SQL: stat subselects must not run for discarded rows.
  const conditions = [];
  if (filters.productId) conditions.push(eq(landingPages.productId, filters.productId));
  if (filters.status) conditions.push(eq(landingPages.status, filters.status));

  const baseQuery = db
    .select({
      id: landingPages.id,
      slug: landingPages.slug,
      name: landingPages.name,
      status: landingPages.status,
      productId: landingPages.productId,
      productName: products.name,
      productHandle: products.handle,
      imageCount: sql<number>`(
        SELECT COUNT(*) FROM landing_page_images
        WHERE landing_page_images.landing_page_id = landing_pages.id
      )`,
      views: landingPages.views,
      publishedAt: landingPages.publishedAt,
      createdAt: landingPages.createdAt,
      updatedAt: landingPages.updatedAt,
      ...STATS_SELECT,
      // Enough of the tracking override to badge the row — never the token.
      // A join rather than a request per row: a merchant running twenty pages
      // wants to see which are on their own pixel in one look.
      trackingPixelId: landingPagePixelConfig.pixelId,
      trackingConversionEvent: landingPagePixelConfig.conversionEvent,
      trackingEnabled: landingPagePixelConfig.enabled,
      trackingTestMode: landingPagePixelConfig.testMode,
    })
    .from(landingPages)
    .leftJoin(products, eq(landingPages.productId, products.id))
    .leftJoin(
      landingPagePixelConfig,
      eq(landingPagePixelConfig.landingPageId, landingPages.id),
    )
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(landingPages.createdAt));

  // $dynamic() because limit/offset are applied conditionally — drizzle's
  // static builder cannot chain .limit(undefined).
  let query = baseQuery.$dynamic();
  if (pagination.limit !== undefined) query = query.limit(pagination.limit);
  if (pagination.offset !== undefined) query = query.offset(pagination.offset);
  const rows = await query;

  return rows.map((row) => {
    const {
      trackingPixelId,
      trackingConversionEvent,
      trackingEnabled,
      trackingTestMode,
      ...rest
    } = row;
    return {
      ...rest,
      imageCount: Number(rest.imageCount),
      views: Number(rest.views),
      orders: Number(rest.orders),
      revenue: Number(rest.revenue),
      tracking: trackingPixelId
        ? {
            pixelId: trackingPixelId,
            conversionEvent: trackingConversionEvent!,
            enabled: Boolean(trackingEnabled),
            testMode: Boolean(trackingTestMode),
          }
        : null,
    };
  });
}

export async function listLandingPages(
  db: AppDb,
  filters: { productId?: string; status?: "draft" | "published" | "archived" } = {},
  pagination: LandingPageListPagination = {},
) {
  return resolveListRow(db, filters, pagination);
}

export async function getLandingPageStats(db: AppDb, id: string): Promise<LandingPageStats | null> {
  const row = await db
    .select({
      views: landingPages.views,
      ...STATS_SELECT,
    })
    .from(landingPages)
    .where(eq(landingPages.id, id))
    .then((rows) => rows[0] ?? null);
  if (!row) return null;
  return {
    views: Number(row.views),
    orders: Number(row.orders),
    revenue: Number(row.revenue),
  };
}

/** Generate the default slug: lp-<8 lowercase hex chars> — collision-checked by the caller. */
export function generateLandingPageSlug(): string {
  return `lp-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

/**
 * Full LP detail by id in TWO round trips (mirrors the slug path's shape):
 *   1. the landing page row by id
 *   2. ONE db.batch carrying images + stats + product ref — a single HTTP
 *      call to D1 instead of three parallel-but-separate queries. Used by
 *      every REST detail read and every MCP write tool's post-mutation read.
 */
export async function getLandingPageById(db: AppDb, id: string) {
  const row = await db
    .select()
    .from(landingPages)
    .where(eq(landingPages.id, id))
    .then((rows) => rows[0] ?? null);
  if (!row) return null;

  const results = await Promise.all([
    db
      .select()
      .from(landingPageImages)
      .where(eq(landingPageImages.landingPageId, id))
      .orderBy(landingPageImages.position),
    db
      .select({
        views: landingPages.views,
        ...STATS_SELECT,
      })
      .from(landingPages)
      .where(eq(landingPages.id, id)),
    db
      .select({ id: products.id, name: products.name, handle: products.handle, price: products.price })
      .from(products)
      .where(eq(products.id, row.productId)),
    db
      .select({ productId: landingPageProducts.productId })
      .from(landingPageProducts)
      .where(eq(landingPageProducts.landingPageId, id))
      .orderBy(landingPageProducts.position),
  ]);

  const images = (results[0] as unknown as typeof landingPageImages.$inferSelect[]) ?? [];
  const statsRow = ((results[1] as unknown as Array<Record<string, unknown>>) ?? [])[0];
  const productRow = ((results[2] as unknown as Array<Record<string, unknown>>) ?? [])[0];
  const pickRows = ((results[3] as unknown as Array<{ productId: string }>) ?? []);

  return {
    ...row,
    images,
    productIds: pickRows.map((r) => r.productId),
    product: productRow
      ? (productRow as unknown as { id: string; name: string; handle: string; price: number })
      : null,
    stats: statsRow
      ? {
          views: Number(statsRow.views),
          orders: Number(statsRow.orders),
          revenue: Number(statsRow.revenue),
        }
      : { views: 0, orders: 0, revenue: 0 },
  };
}

/**
 * Full LP detail by slug in TWO round trips (the public render path):
 *   1. the landing page row by slug
 *   2. ONE db.batch carrying images + stats + product ref — a single HTTP
 *      call to D1 (batched statements), instead of re-selecting the row by
 *      id and issuing four more queries.
 */
export async function getLandingPageDetailBySlug(db: AppDb, slug: string) {
  const row = await db
    .select()
    .from(landingPages)
    .where(eq(landingPages.slug, slug))
    .then((rows) => rows[0] ?? null);
  if (!row) return null;

  const results = await Promise.all([
    db
      .select()
      .from(landingPageImages)
      .where(eq(landingPageImages.landingPageId, row.id))
      .orderBy(landingPageImages.position),
    db
      .select({
        views: landingPages.views,
        ...STATS_SELECT,
      })
      .from(landingPages)
      .where(eq(landingPages.id, row.id)),
    db
      .select({ id: products.id, name: products.name, handle: products.handle, price: products.price })
      .from(products)
      .where(eq(products.id, row.productId)),
    db
      .select({ productId: landingPageProducts.productId })
      .from(landingPageProducts)
      .where(eq(landingPageProducts.landingPageId, row.id))
      .orderBy(landingPageProducts.position),
  ]);

  const images = (results[0] as unknown as typeof landingPageImages.$inferSelect[]) ?? [];
  const statsRow = ((results[1] as unknown as Array<Record<string, unknown>>) ?? [])[0];
  const productRow = ((results[2] as unknown as Array<Record<string, unknown>>) ?? [])[0];
  const pickRows = ((results[3] as unknown as Array<{ productId: string }>) ?? []);

  return {
    ...row,
    images,
    productIds: pickRows.map((r) => r.productId),
    product: productRow
      ? (productRow as unknown as { id: string; name: string; handle: string; price: number })
      : null,
    stats: statsRow
      ? {
          views: Number(statsRow.views),
          orders: Number(statsRow.orders),
          revenue: Number(statsRow.revenue),
        }
      : { views: 0, orders: 0, revenue: 0 },
  };
}

export async function getLandingPageBySlug(db: AppDb, slug: string) {
  const row = await db
    .select()
    .from(landingPages)
    .where(eq(landingPages.slug, slug))
    .then((rows) => rows[0] ?? null);
  if (!row) return null;
  return getLandingPageById(db, row.id);
}

export async function createLandingPage(
  db: AppDb,
  data: CreateLandingPageData,
): Promise<{ id: string; slug: string }> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const slug = data.slug ?? generateLandingPageSlug();

  await db.insert(landingPages).values({
    id,
    slug,
    name: data.name,
    productId: data.productId,
    kind: data.kind ?? "single",
    status: "draft",
    imageGap: data.imageGap ?? 0,
    metaTitle: data.metaTitle ?? null,
    metaDescription: data.metaDescription ?? null,
    views: 0,
    createdAt: now,
    updatedAt: now,
  });

  if (data.productIds && data.productIds.length > 0) {
    await setLandingPageProducts(db, id, data.productIds);
  }

  return { id, slug };
}

export async function updateLandingPage(
  db: AppDb,
  id: string,
  data: UpdateLandingPageData,
) {
  const now = new Date().toISOString();
  await db
    .update(landingPages)
    .set({
      ...(data.name !== undefined && { name: data.name }),
      ...(data.slug !== undefined && { slug: data.slug }),
      ...(data.imageGap !== undefined && { imageGap: data.imageGap }),
      ...(data.metaTitle !== undefined && { metaTitle: data.metaTitle ?? null }),
      ...(data.metaDescription !== undefined && { metaDescription: data.metaDescription ?? null }),
      updatedAt: now,
    })
    .where(eq(landingPages.id, id));
}

export async function publishLandingPage(db: AppDb, id: string) {
  const now = new Date().toISOString();
  await db
    .update(landingPages)
    .set({ status: "published", publishedAt: now, updatedAt: now })
    .where(eq(landingPages.id, id));
}

export async function unpublishLandingPage(db: AppDb, id: string) {
  const now = new Date().toISOString();
  await db
    .update(landingPages)
    .set({ status: "draft", updatedAt: now })
    .where(eq(landingPages.id, id));
}

export async function archiveLandingPage(db: AppDb, id: string) {
  const now = new Date().toISOString();
  await db
    .update(landingPages)
    .set({ status: "archived", updatedAt: now })
    .where(eq(landingPages.id, id));
}

/** Count orders attributed to a landing page — powers the delete guard. */
export async function countLandingPageOrders(db: AppDb, id: string): Promise<number> {
  const row = await db
    .select({ c: count() })
    .from(orders)
    .where(eq(orders.landingPageId, id))
    .then((rows) => rows[0] ?? null);
  return Number(row?.c ?? 0);
}

export async function deleteLandingPage(db: AppDb, id: string) {
  // Images cascade at the DB level; orders must be absent (guarded by the caller).
  await db.delete(landingPages).where(eq(landingPages.id, id));
}

export async function addLandingPageImage(
  db: AppDb,
  landingPageId: string,
  image: LandingPageImageInput,
) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const lastRow = await db
    .select({ maxPos: sql<number>`MAX(${landingPageImages.position})` })
    .from(landingPageImages)
    .where(eq(landingPageImages.landingPageId, landingPageId))
    .then((rows) => rows[0] ?? null);
  const nextPosition = image.position ?? Number(lastRow?.maxPos ?? 0) + 1;

  await db.insert(landingPageImages).values({
    id,
    landingPageId,
    r2Key: image.r2Key,
    src: image.src,
    altText: image.altText ?? null,
    source: image.source ?? "upload",
    position: nextPosition,
    width: image.width ?? null,
    height: image.height ?? null,
    createdAt: now,
  });

  return getLandingPageImages(db, landingPageId);
}

export async function getLandingPageImages(db: AppDb, landingPageId: string) {
  return db
    .select()
    .from(landingPageImages)
    .where(eq(landingPageImages.landingPageId, landingPageId))
    .orderBy(landingPageImages.position)
    ;
}

export async function getLandingPageImage(
  db: AppDb,
  landingPageId: string,
  imageId: string,
) {
  return db
    .select()
    .from(landingPageImages)
    .where(
      and(
        eq(landingPageImages.id, imageId),
        eq(landingPageImages.landingPageId, landingPageId),
      ),
    )
    .then((rows) => rows[0] ?? null);
}

export async function reorderLandingPageImages(
  db: AppDb,
  landingPageId: string,
  imageIds: string[],
) {
  const now = new Date().toISOString();
  // One atomic transaction: every position update + the parent touch commit
  // together — the per-image await loop was N+1 sequential D1 calls.
  await db.transaction(async (tx) => {
    for (const [index, imageId] of imageIds.entries()) {
      await tx
        .update(landingPageImages)
        .set({ position: index + 1 })
        .where(
          and(
            eq(landingPageImages.id, imageId),
            eq(landingPageImages.landingPageId, landingPageId),
          ),
        );
    }
    // Touch the parent's updatedAt so the studio knows the stack changed.
    await tx
      .update(landingPages)
      .set({ updatedAt: now })
      .where(eq(landingPages.id, landingPageId));
  });
  return getLandingPageImages(db, landingPageId);
}

export async function deleteLandingPageImage(
  db: AppDb,
  landingPageId: string,
  imageId: string,
) {
  await db
    .delete(landingPageImages)
    .where(
      and(
        eq(landingPageImages.id, imageId),
        eq(landingPageImages.landingPageId, landingPageId),
      ),
    );
}

/** Ordered product ids picked on a multi page (empty for single pages). */
export async function getLandingPageProducts(db: AppDb, landingPageId: string) {
  return db
    .select()
    .from(landingPageProducts)
    .where(eq(landingPageProducts.landingPageId, landingPageId))
    .orderBy(landingPageProducts.position);
}

/**
 * Replace the whole pick list: delete + re-insert with 1-based positions in
 * one transaction, touching the parent so the studio sees the change.
 * Duplicates are collapsed (first occurrence wins); product existence is the
 * caller's guard (cod-server wrapper), mirroring the image-reorder split.
 */
export async function setLandingPageProducts(
  db: AppDb,
  landingPageId: string,
  productIds: string[],
) {
  const now = new Date().toISOString();
  const deduped = [...new Set(productIds)];
  await db.transaction(async (tx) => {
    await tx
      .delete(landingPageProducts)
      .where(eq(landingPageProducts.landingPageId, landingPageId));
    for (const [index, productId] of deduped.entries()) {
      await tx.insert(landingPageProducts).values({
        id: crypto.randomUUID(),
        landingPageId,
        productId,
        position: index + 1,
        createdAt: now,
      });
    }
    await tx
      .update(landingPages)
      .set({ updatedAt: now })
      .where(eq(landingPages.id, landingPageId));
  });
  return getLandingPageProducts(db, landingPageId);
}

/** Append one pick at the end — a no-op when the product is already picked. */
export async function addLandingPageProduct(
  db: AppDb,
  landingPageId: string,
  productId: string,
) {
  const existing = await getLandingPageProducts(db, landingPageId);
  if (existing.some((r) => r.productId === productId)) return existing;
  const now = new Date().toISOString();
  await db.transaction(async (tx) => {
    await tx.insert(landingPageProducts).values({
      id: crypto.randomUUID(),
      landingPageId,
      productId,
      position: existing.length + 1,
      createdAt: now,
    });
    await tx
      .update(landingPages)
      .set({ updatedAt: now })
      .where(eq(landingPages.id, landingPageId));
  });
  return getLandingPageProducts(db, landingPageId);
}

export async function removeLandingPageProduct(
  db: AppDb,
  landingPageId: string,
  productId: string,
) {
  await db
    .delete(landingPageProducts)
    .where(
      and(
        eq(landingPageProducts.landingPageId, landingPageId),
        eq(landingPageProducts.productId, productId),
      ),
    );
}

export async function reorderLandingPageProducts(
  db: AppDb,
  landingPageId: string,
  productIds: string[],
) {
  const now = new Date().toISOString();
  await db.transaction(async (tx) => {
    for (const [index, productId] of productIds.entries()) {
      await tx
        .update(landingPageProducts)
        .set({ position: index + 1 })
        .where(
          and(
            eq(landingPageProducts.landingPageId, landingPageId),
            eq(landingPageProducts.productId, productId),
          ),
        );
    }
    await tx
      .update(landingPages)
      .set({ productId: productIds[0], updatedAt: now })
      .where(eq(landingPages.id, landingPageId));
  });
  return getLandingPageProducts(db, landingPageId);
}

/**
 * Advance the cover product (landing_pages.product_id) — keeps list/compare
 * rendering after the first pick changes. Cover is otherwise immutable.
 */
export async function updateLandingPageCover(
  db: AppDb,
  id: string,
  productId: string,
) {
  await db
    .update(landingPages)
    .set({ productId, updatedAt: new Date().toISOString() })
    .where(eq(landingPages.id, id));
}

/** Ordered (handle) refs of a multi page's picks — the storefront resolves full shapes per handle. */
export async function getLandingPagePickHandles(
  db: AppDb,
  landingPageId: string,
): Promise<string[]> {
  const rows = await db
    .select({ handle: products.handle })
    .from(landingPageProducts)
    .innerJoin(products, eq(landingPageProducts.productId, products.id))
    .where(eq(landingPageProducts.landingPageId, landingPageId))
    .orderBy(landingPageProducts.position);
  return rows.map((r) => r.handle);
}

/** Landing pages that still exist and are published — the attribution-resolvable set. */
export async function findPublishedLandingPageIdBySlug(
  db: AppDb,
  slug: string,
): Promise<string | null> {
  const row = await db
    .select({ id: landingPages.id })
    .from(landingPages)
    .where(and(eq(landingPages.slug, slug), eq(landingPages.status, "published")))
    .then((rows) => rows[0] ?? null);
  return row?.id ?? null;
}

/** Comparison view source: every LP of one product with its stats, newest first. */
export async function compareLandingPages(db: AppDb, productId: string) {
  return resolveListRow(db, { productId });
}

/**
 * Duplicate a landing page: new row (draft, fresh slug, zeroed views) plus
 * copies of every image row. Image rows SHARE the original R2 keys — R2
 * objects are immutable, so references are safe and cache-friendly; the
 * image-delete path reference-counts keys so a shared object is only
 * removed from R2 when the last row referencing it goes away.
 * Attribution, views, and published state are NEVER copied — a duplicate is
 * a fresh creative test, not a stats clone.
 */
export async function duplicateLandingPage(db: AppDb, id: string): Promise<string | null> {
  const source = await db
    .select()
    .from(landingPages)
    .where(eq(landingPages.id, id))
    .then((rows) => rows[0] ?? null);
  if (!source) return null;

  const images = await db
    .select()
    .from(landingPageImages)
    .where(eq(landingPageImages.landingPageId, id))
    .orderBy(landingPageImages.position)
    ;

  const picks = await db
    .select()
    .from(landingPageProducts)
    .where(eq(landingPageProducts.landingPageId, id))
    .orderBy(landingPageProducts.position)
    ;

  const newId = crypto.randomUUID();
  const now = new Date().toISOString();
  const slug = generateLandingPageSlug();

  await db.transaction(async (tx) => {
    await tx.insert(landingPages).values({
      id: newId,
      slug,
      name: `${source.name} (copy)`,
      productId: source.productId,
      kind: source.kind,
      status: "draft",
      imageGap: source.imageGap,
      metaTitle: source.metaTitle,
      metaDescription: source.metaDescription,
      views: 0,
      createdAt: now,
      updatedAt: now,
    });
    for (const image of images) {
      await tx.insert(landingPageImages).values({
        id: crypto.randomUUID(),
        landingPageId: newId,
        r2Key: image.r2Key,
        src: image.src,
        altText: image.altText,
        source: image.source,
        position: image.position,
        width: image.width,
        height: image.height,
        createdAt: now,
      });
    }
    for (const pick of picks) {
      await tx.insert(landingPageProducts).values({
        id: crypto.randomUUID(),
        landingPageId: newId,
        productId: pick.productId,
        position: pick.position,
        createdAt: now,
      });
    }
  });

  return newId;
}

/**
 * Count landing-page image rows referencing an R2 key besides the given one —
 * powers the shared-object guard on image deletion (duplicates reference the
 * same immutable R2 object).
 */
export async function countOtherLandingPageImageReferences(
  db: AppDb,
  r2Key: string,
  excludeImageId: string,
): Promise<number> {
  const row = await db
    .select({ c: count() })
    .from(landingPageImages)
    .where(and(eq(landingPageImages.r2Key, r2Key), sql`${landingPageImages.id} <> ${excludeImageId}`))
    .then((rows) => rows[0] ?? null);
  return Number(row?.c ?? 0);
}

export async function slugExists(db: AppDb, slug: string): Promise<boolean> {
  const row = await db
    .select({ id: landingPages.id })
    .from(landingPages)
    .where(eq(landingPages.slug, slug))
    .then((rows) => rows[0] ?? null);
  return row !== undefined;
}

/**
 * Atomic view increment — one UPDATE per render, no read-modify-write race.
 * Called by the public store endpoint for published pages only.
 */
export async function incrementLandingPageViews(db: AppDb, id: string): Promise<void> {
  await db
    .update(landingPages)
    .set({ views: sql`${landingPages.views} + 1` })
    .where(eq(landingPages.id, id));
}

/**
 * The storefront's public base URL — where landing page links point.
 *
 * Resolution order (single source of truth, zero hardcoding):
 *   1. The store's own domain (stores.domain, set by the merchant in Store
 *      Settings — each deployment connects its own custom domain).
 *   2. The caller's fallback (cod-server's optional STOREFRONT_URL var —
 *      for deployments without a custom domain yet).
 *   3. null — the caller renders a relative path.
 *
 * https is always assumed; the domain is stored as a bare hostname.
 */
export async function resolveStorefrontBaseUrl(
  db: AppDb,
  fallbackUrl?: string,
): Promise<string | null> {
  const store = await db
    .select({ domain: stores.domain })
    .from(stores)
    .limit(1)
    .then((rows) => rows[0] ?? null);
  if (store?.domain) return `https://${store.domain}`;
  const fallback = (fallbackUrl ?? "").replace(/\/+$/, "");
  return fallback || null;
}

/** Build the public landing page URL against a resolved base (null → relative). */
export function buildLandingPagePublicUrl(
  baseUrl: string | null,
  slug: string,
): string {
  return baseUrl ? `${baseUrl}/lp/${slug}` : `/lp/${slug}`;
}

export interface LpImageUploadJobResult {
  imageId: string;
  src: string;
  position: number | null;
  width: number | null;
  height: number | null;
  altText: string | null;
}

/** Insert a `processing` upload job row. Id is the `lpimg-<hex>` job id. */
export async function createLpImageUploadJob(
  db: AppDb,
  job: { id: string; landingPageId: string; r2Key: string },
): Promise<void> {
  const now = new Date().toISOString();
  await db.insert(lpImageUploadJobs).values({
    id: job.id,
    landingPageId: job.landingPageId,
    r2Key: job.r2Key,
    status: "processing",
    createdAt: now,
    updatedAt: now,
  });
}

export async function getLpImageUploadJob(db: AppDb, id: string) {
  return db
    .select()
    .from(lpImageUploadJobs)
    .where(eq(lpImageUploadJobs.id, id))
    .then((rows) => rows[0] ?? null);
}

export async function markLpImageUploadComplete(
  db: AppDb,
  id: string,
  result: LpImageUploadJobResult,
): Promise<void> {
  await db
    .update(lpImageUploadJobs)
    .set({
      status: "complete",
      error: null,
      imageId: result.imageId,
      src: result.src,
      position: result.position,
      width: result.width,
      height: result.height,
      altText: result.altText,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(lpImageUploadJobs.id, id));
}

export async function markLpImageUploadFailed(
  db: AppDb,
  id: string,
  error: string,
): Promise<void> {
  await db
    .update(lpImageUploadJobs)
    .set({ status: "failed", error, updatedAt: new Date().toISOString() })
    .where(eq(lpImageUploadJobs.id, id));
}
