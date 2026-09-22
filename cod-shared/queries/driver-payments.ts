import { eq, and, isNull, desc } from "drizzle-orm";
import { orders, driverPayments } from "../db/schema.pg";
import type { PgDb } from "../db/client.pg";

/**
 * Get all payment records for a driver, most recent first.
 */
export async function getDriverPayments(db: PgDb, driverId: string) {
  return db
    .select()
    .from(driverPayments)
    .where(eq(driverPayments.driverId, driverId))
    .orderBy(desc(driverPayments.createdAt))
    ;
}

/**
 * Get delivered, unsettled orders for a driver.
 * Returns orders where COD hasn't been settled yet.
 */
export async function getPendingSettlementOrders(db: PgDb, driverId: string) {
  return db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.driverId, driverId),
        eq(orders.status, "delivered"),
        isNull(orders.codPaymentId),
      ),
    )
    .orderBy(desc(orders.updatedAt))
    ;
}
