/**
 * Abandoned Orders Queries
 */

import { eq, and, desc, lt, sql, ilike, or } from "drizzle-orm";
import { abandonedOrders, wilayas, communes } from "../db/schema.pg";
import type { PgDb } from "../db/client.pg";
import { safeLikeTerm } from "./search";

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
      productId: data.productId ?? null,
      productName: data.productName ?? null,
      variantId: data.variantId ?? null,
      variantLabel: data.variantLabel ?? null,
      price: data.price ?? null,
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
        productId: data.productId ?? null,
        productName: data.productName ?? null,
        variantId: data.variantId ?? null,
        variantLabel: data.variantLabel ?? null,
        price: data.price ?? null,
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
  // "هنوس pending + converted" confusion. Keep only this converted row.
  if (row?.phone) {
    await db
      .delete(abandonedOrders)
      .where(
        and(
          eq(abandonedOrders.phone, row.phone),
          sql`${abandonedOrders.sessionId} != ${sessionId}`,
          sql`${abandonedOrders.status} IN ('pending','abandoned')`
        )
      );
  }
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

  return { rows, total: countRows[0]?.count ?? 0 };
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
