import { eq, and, desc, sql } from "drizzle-orm";
import { reviews, products } from "../db/schema.pg";
import type { PgDb } from "../db/client.pg";

export type ReviewStatus = "pending" | "approved" | "rejected";

export interface ReviewFilters {
  status?: ReviewStatus;
  productId?: string;
  limit: number;
  offset: number;
}

export async function getAllReviews(db: PgDb, filters: ReviewFilters) {
  const conditions: any[] = [];

  if (filters.status) conditions.push(eq(reviews.status, filters.status));
  if (filters.productId) conditions.push(eq(reviews.productId, filters.productId));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, totalRows, pendingRows] = await Promise.all([
    db
      .select({
        id: reviews.id,
        storeId: reviews.storeId,
        productId: reviews.productId,
        orderId: reviews.orderId,
        orderNumber: reviews.orderNumber,
        customerName: reviews.customerName,
        rating: reviews.rating,
        title: reviews.title,
        body: reviews.body,
        status: reviews.status,
        helpfulCount: reviews.helpfulCount,
        createdAt: reviews.createdAt,
        updatedAt: reviews.updatedAt,
        productName: products.name,
      })
      .from(reviews)
      .leftJoin(products, eq(reviews.productId, products.id))
      .where(where)
      .orderBy(desc(reviews.createdAt))
      .limit(filters.limit)
      .offset(filters.offset),
    db.select({ count: sql<number>`count(*)` }).from(reviews).where(where),
    db
      .select({ count: sql<number>`count(*)` })
      .from(reviews)
      .where(eq(reviews.status, "pending")),
  ]);

  return {
    rows,
    total: totalRows[0]?.count ?? 0,
    pendingCount: pendingRows[0]?.count ?? 0,
  };
}

export async function getReviewById(db: PgDb, id: string) {
  return db
    .select()
    .from(reviews)
    .where(eq(reviews.id, id))
    .then((rows) => rows[0] ?? null);
}

export async function updateReviewStatus(
  db: PgDb,
  id: string,
  status: ReviewStatus,
) {
  const now = new Date().toISOString();
  await db
    .update(reviews)
    .set({ status, updatedAt: now })
    .where(eq(reviews.id, id));
  return db.select().from(reviews).where(eq(reviews.id, id)).then((rows) => rows[0] ?? null);
}

export async function deleteReview(db: PgDb, id: string) {
  await db.delete(reviews).where(eq(reviews.id, id));
}
