/**
 * Abandoned Orders Queries
 */

import { eq, and, desc, lt, sql, ilike, or, inArray, ne } from "drizzle-orm";
import { abandonedOrders, wilayas, communes } from "../db/schema.pg";
import type { PgDb } from "../db/client.pg";
import { safeLikeTerm } from "./search";

/** Normalize an Algerian mobile to canonical local form (0[567]XXXXXXXX), or null. */
export function normalizeDzPhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  let local = digits;
  if (local.startsWith("00213")) local = local.slice(5);
  else if (local.startsWith("213")) local = local.slice(3);
  if (local.startsWith("0")) local = local.slice(1);
  return /^[567]\d{8}$/.test(local) ? `0${local}` : null;
}

/**
 * Textual variants of a phone for DB matching. Shoppers type the same number
 * as 0558…, +213…, 213… or 00213… across tabs/sessions — exact-match dedup
 * misses those, leaving phantom pending/abandoned rows behind.
 */
export function phoneMatchVariants(phone: string): string[] {
  const variants = new Set<string>([phone]);
  const canonical = normalizeDzPhone(phone);
  if (canonical) {
    const national = canonical.slice(1);
    variants.add(canonical);
    variants.add(`+213${national}`);
    variants.add(`213${national}`);
    variants.add(`00213${national}`);
  }
  return [...variants];
}

export interface UpsertAbandonedOrderData {
  sessionId: string;
  customerName: string;
  phone: string;
  wilayaId?: number;
  communeId?: string;
  wilayaName?: string;
  communeName?: string;
  productId?: string;
  productName?: string;
  variantId?: string;
  variantLabel?: string;
  price?: number;
  deliveryType?: (typeof abandonedOrders.$inferSelect)["deliveryType"];
  fbc?: string;
  fbp?: string;
  ipAddress?: string;
  userAgent?: string;
  /**
   * The whole basket, when the shopper abandoned a cart checkout. Absent for a
   * single-product checkout, which keeps using the flat fields above.
   */
  items?: AbandonedItem[];
}

/** One line of an abandoned basket, as the storefront captured it. */
export interface AbandonedItem {
  productId: string;
  productName: string;
  variantId?: string | null;
  variantLabel?: string | null;
  quantity: number;
  unitPrice: number;
}

/** The columns a record stores for what was in the checkout. */
export interface AbandonedProductColumns {
  productId: string | null;
  productName: string | null;
  variantId: string | null;
  variantLabel: string | null;
  price: number | null;
  itemsJson: string | null;
  itemCount: number | null;
}

/**
 * Flatten what the shopper was buying into the columns the record stores.
 *
 * Pure, and deliberately the only place the two shapes meet.
 *
 * With no basket this returns the caller's flat fields untouched, so a
 * single-product checkout is stored exactly as it was before carts existed.
 *
 * With a basket, the flat columns are filled from the FIRST line. That is not
 * cosmetic: the dashboard's product column, the customer search and the
 * lost-revenue sum all read those columns, and filling them is what let this
 * change ship without rewriting any of them. `price` follows its documented
 * meaning — cart value at abandonment — so for a basket it is the subtotal,
 * not one line's unit price.
 */
export function deriveAbandonedProductColumns(
  data: Pick<
    UpsertAbandonedOrderData,
    "items" | "productId" | "productName" | "variantId" | "variantLabel" | "price"
  >,
): AbandonedProductColumns {
  const items = data.items;

  if (!items || items.length === 0) {
    return {
      productId: data.productId ?? null,
      productName: data.productName ?? null,
      variantId: data.variantId ?? null,
      variantLabel: data.variantLabel ?? null,
      price: data.price ?? null,
      itemsJson: null,
      itemCount: null,
    };
  }

  const first = items[0];
  const subtotal = items.reduce((total, item) => total + item.unitPrice * item.quantity, 0);

  return {
    productId: first.productId,
    productName: first.productName,
    variantId: first.variantId ?? null,
    variantLabel: first.variantLabel ?? null,
    price: subtotal,
    itemsJson: JSON.stringify(items),
    itemCount: items.length,
  };
}

/**
 * Read a stored basket back.
 *
 * Anything unreadable resolves to "no basket" rather than throwing: a record
 * written by a future shape, or hand-edited, must still list in the dashboard
 * with its flat product column intact.
 */
export function parseAbandonedItems(raw: string | null | undefined): AbandonedItem[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const items = parsed.filter(
      (entry): entry is AbandonedItem =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as AbandonedItem).productId === "string" &&
        typeof (entry as AbandonedItem).productName === "string" &&
        Number.isFinite((entry as AbandonedItem).quantity) &&
        Number.isFinite((entry as AbandonedItem).unitPrice),
    );
    return items.length > 0 ? items : null;
  } catch {
    return null;
  }
}

export interface AbandonedOrderFilters {
  status?: (typeof abandonedOrders.$inferSelect)["status"];
  search?: string;
  limit?: number;
  offset?: number;
}

export async function upsertAbandonedOrder(
  db: PgDb,
  data: UpsertAbandonedOrderData
): Promise<string> {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const product = deriveAbandonedProductColumns(data);

  await db
    .insert(abandonedOrders)
    .values({
      id,
      sessionId: data.sessionId,
      customerName: data.customerName,
      phone: data.phone,
      wilayaId: data.wilayaId ?? null,
      communeId: data.communeId ?? null,
      wilayaName: data.wilayaName ?? null,
      communeName: data.communeName ?? null,
      ...product,
      deliveryType: data.deliveryType ?? null,
      fbc: data.fbc ?? null,
      fbp: data.fbp ?? null,
      ipAddress: data.ipAddress ?? null,
      userAgent: data.userAgent ?? null,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: abandonedOrders.sessionId,
      set: {
        customerName: data.customerName,
        phone: data.phone,
        wilayaId: data.wilayaId ?? null,
        communeId: data.communeId ?? null,
        wilayaName: data.wilayaName ?? null,
        communeName: data.communeName ?? null,
        ...product,
        deliveryType: data.deliveryType ?? null,
        fbc: data.fbc ?? null,
        fbp: data.fbp ?? null,
        ipAddress: data.ipAddress ?? null,
        userAgent: data.userAgent ?? null,
        updatedAt: now,
      },
    });

  // Return the id of the upserted row
  const row = await db
    .select({ id: abandonedOrders.id })
    .from(abandonedOrders)
    .where(eq(abandonedOrders.sessionId, data.sessionId))
    .limit(1)
    .then((r) => r[0]);

  return row?.id ?? id;
}

export async function markAbandonedOrderConverted(
  db: PgDb,
  sessionId: string,
  orderId: string,
  orderNumber: string
): Promise<void> {
  const now = new Date().toISOString();
  const row = await db
    .select({ phone: abandonedOrders.phone })
    .from(abandonedOrders)
    .where(eq(abandonedOrders.sessionId, sessionId))
    .then((r) => r[0] ?? null);
  await db
    .update(abandonedOrders)
    .set({
      status: "converted",
      convertedOrderId: orderId,
      convertedOrderNumber: orderNumber,
      updatedAt: now,
    })
    .where(
      and(
        eq(abandonedOrders.sessionId, sessionId),
        sql`${abandonedOrders.status} != 'converted'`
      )
    );
  // Deduplicate: if this phone had other pending/abandoned checkouts, they are
  // now stale — the customer did order, so remove the duplicates to avoid the
  // "pending + converted" confusion. Keep only this converted row.
  // Match is format-tolerant (0558… vs +213…): same number typed differently
  // across tabs must still collapse.
  if (row?.phone) {
    await db
      .delete(abandonedOrders)
      .where(
        and(
          inArray(abandonedOrders.phone, phoneMatchVariants(row.phone)),
          ne(abandonedOrders.sessionId, sessionId),
          inArray(abandonedOrders.status, ["pending", "abandoned"])
        )
      );
  }
}

/**
 * Server-side reconcile, called right after a store order is created.
 * The browser convert signal is unreliable (per-tab sessionStorage, closed
 * tabs, ad-blocked fetch) — so the order itself is the source of truth:
 * - open rows older than this phone's latest conversion are stale leftovers
 *   from previous purchases → delete.
 * - of the remaining fresh rows (this shopping trip, possibly multi-tab),
 *   the newest carries this order's attribution → converted; the rest are
 *   same-trip duplicates → delete.
 * Never throws past the caller: order creation must not depend on it, so
 * callers wrap it in try/catch.
 */
export async function reconcileAbandonedOrdersOnOrder(
  db: PgDb,
  phone: string,
  orderId: string,
  orderNumber: string
): Promise<void> {
  const now = new Date().toISOString();
  const variants = phoneMatchVariants(phone);

  const candidates = await db
    .select({
      id: abandonedOrders.id,
      status: abandonedOrders.status,
      createdAt: abandonedOrders.createdAt,
      updatedAt: abandonedOrders.updatedAt,
    })
    .from(abandonedOrders)
    .where(
      and(
        inArray(abandonedOrders.phone, variants),
        inArray(abandonedOrders.status, ["pending", "abandoned", "converted"])
      )
    )
    .orderBy(desc(abandonedOrders.createdAt));

  if (candidates.length === 0) return;

  const open = candidates.filter((r) => r.status !== "converted");
  if (open.length === 0) return;

  const latestConversionAt = candidates
    .filter((r) => r.status === "converted")
    .map((r) => r.updatedAt)
    .sort()
    .at(-1);

  const staleIds = latestConversionAt
    ? open.filter((r) => r.createdAt < latestConversionAt).map((r) => r.id)
    : [];
  if (staleIds.length > 0) {
    await db.delete(abandonedOrders).where(inArray(abandonedOrders.id, staleIds));
  }

  const fresh = open.filter((r) => !staleIds.includes(r.id));
  if (fresh.length === 0) return;

  const [winner, ...losers] = fresh;
  await db
    .update(abandonedOrders)
    .set({
      status: "converted",
      convertedOrderId: orderId,
      convertedOrderNumber: orderNumber,
      updatedAt: now,
    })
    .where(eq(abandonedOrders.id, winner.id));
  if (losers.length > 0) {
    await db
      .delete(abandonedOrders)
      .where(inArray(abandonedOrders.id, losers.map((r) => r.id)));
  }
}

/**
 * Cron cleanup for duplicates: a phone with a converted row must not keep
 * any pending/abandoned sibling — one shopper, one status. Returns the
 * number of rows purged.
 */
export async function purgeStaleAbandonedSiblings(db: PgDb): Promise<number> {
  const convertedPhones = await db
    .selectDistinct({ phone: abandonedOrders.phone })
    .from(abandonedOrders)
    .where(eq(abandonedOrders.status, "converted"));

  let purged = 0;
  for (const { phone } of convertedPhones) {
    const deleted = await db
      .delete(abandonedOrders)
      .where(
        and(
          inArray(abandonedOrders.phone, phoneMatchVariants(phone)),
          inArray(abandonedOrders.status, ["pending", "abandoned"])
        )
      )
      .returning({ id: abandonedOrders.id });
    purged += deleted.length;
  }
  return purged;
}

/** Cron: flip pending → abandoned for records older than 30 minutes. Returns count. */
export async function sweepPendingToAbandoned(db: PgDb): Promise<number> {
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  const result = await db
    .update(abandonedOrders)
    .set({ status: "abandoned", updatedAt: now })
    .where(
      and(
        eq(abandonedOrders.status, "pending"),
        lt(abandonedOrders.createdAt, cutoff)
      )
    )
    .returning({ id: abandonedOrders.id });

  return result.length;
}

export async function listAbandonedOrders(
  db: PgDb,
  filters: AbandonedOrderFilters = {}
) {
  const { status, search, limit = 50, offset = 0 } = filters;
  const conditions = [];

  if (status) {
    conditions.push(eq(abandonedOrders.status, status));
  }

  if (search) {
    const term = `%${safeLikeTerm(search)}%`;
    conditions.push(
      or(
        ilike(abandonedOrders.customerName, term),
        ilike(abandonedOrders.phone, term)
      )
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(abandonedOrders)
      .where(where)
      .orderBy(desc(abandonedOrders.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(abandonedOrders).where(where),
  ]);

  // The basket is parsed here rather than in the dashboard: the API's job is to
  // hand back a basket, not a string the client has to know how to decode.
  const withItems = rows.map(({ itemsJson, ...row }) => ({
    ...row,
    items: parseAbandonedItems(itemsJson),
  }));

  return { rows: withItems, total: countRows[0]?.count ?? 0 };
}

export async function getAbandonedOrderStats(db: PgDb) {
  const [totalRows, convertedRows, revenueRows] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)` })
      .from(abandonedOrders)
      .where(eq(abandonedOrders.status, "abandoned")),
    db
      .select({ count: sql<number>`count(*)` })
      .from(abandonedOrders)
      .where(eq(abandonedOrders.status, "converted")),
    db
      .select({ total: sql<number>`coalesce(sum(price), 0)` })
      .from(abandonedOrders)
      .where(eq(abandonedOrders.status, "abandoned")),
  ]);

  const totalAbandoned = totalRows[0]?.count ?? 0;
  const totalConverted = convertedRows[0]?.count ?? 0;
  const totalAttempted = totalAbandoned + totalConverted;
  const conversionRate =
    totalAttempted > 0 ? Math.round((totalConverted / totalAttempted) * 100) : 0;
  const estimatedLostRevenue = revenueRows[0]?.total ?? 0;

  return { totalAbandoned, totalConverted, conversionRate, estimatedLostRevenue };
}

export async function updateAbandonedOrderStatus(
  db: PgDb,
  id: string,
  status: (typeof abandonedOrders.$inferSelect)["status"]
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .update(abandonedOrders)
    .set({ status, updatedAt: now })
    .where(eq(abandonedOrders.id, id));
}

export async function deleteAbandonedOrder(db: PgDb, id: string): Promise<void> {
  await db.delete(abandonedOrders).where(eq(abandonedOrders.id, id));
}
