/**
 * Orders Queries
 *
 * Centralized database operations for orders management.
 */

import type { AppDb } from "../db/client";
import { batchAll } from "../lib/batch";
import type { BatchItem } from "drizzle-orm/batch";
import {
  orders,
  orderProducts,
  orderStatusHistory,
  customers,
  productVariants,
  products,
  drivers,
  driverCompensations,
  users,
  wilayas,
  communes,
  stockMovements,
  companyShipments,
  companyApiLogs,
  webhookEvents,
  capiEventLog,
  tiktokEventLog,
} from "../db/schema";
import type { OrderStatus } from "../db/schema";
import {
  eq,
  desc,
  and,
  ilike,
  or,
  sql,
  getTableColumns,
  aliasedTable,
} from "drizzle-orm";
import { ilikeFold } from "../lib/search";

const driversAlias = aliasedTable(drivers, "d");

import { safeLikeTerm } from "./search";
import { getCustomerByPhone, updateCustomer, type UpdateCustomerData } from "./customers";

export interface OrderFilters {
  status?: (typeof orders.$inferSelect)["status"] | "all";
  wilayaId?: number;
  search?: string;
  /** Only orders containing this product (matches order_products lines). */
  productId?: string;
  limit?: number;
  offset?: number;
  /**
   * Opaque keyset cursor (encodeOrderCursor output): return rows strictly
   * before (createdAt, id). Takes precedence over offset when set.
   */
  cursor?: string;
}

export function encodeOrderCursor(createdAt: string, id: string): string {
  return btoa(`${createdAt}|${id}`)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function parseOrderCursor(
  cursor: string,
): { createdAt: string; id: string } | null {
  try {
    const b64 = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(b64);
    const sep = decoded.lastIndexOf("|");
    if (sep <= 0) return null;
    const createdAt = decoded.slice(0, sep);
    const id = decoded.slice(sep + 1);
    if (!id) return null;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(createdAt)) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/**
 * Get all orders with optional filtering.
 * Joins wilayas + communes to return Arabic display names.
 */
export async function getAllOrders(db: AppDb, filters: OrderFilters = {}) {
  const conditions = [];

  if (filters.status && filters.status !== "all") {
    conditions.push(eq(orders.status, filters.status));
  }

  if (filters.wilayaId) {
    conditions.push(eq(orders.wilayaId, filters.wilayaId));
  }

  if (filters.productId) {
    // EXISTS keeps one row per order — a plain join would duplicate orders
    // that contain the product on several lines and break pagination.
    conditions.push(
      sql`EXISTS (SELECT 1 FROM ${orderProducts} WHERE ${orderProducts.orderId} = ${orders.id} AND ${orderProducts.productId} = ${filters.productId})`
    );
  }

  if (filters.search) {
    const term = `%${safeLikeTerm(filters.search)}%`;
    conditions.push(
      or(
        ilikeFold(orders.orderNumber, term),
        ilikeFold(orders.customerName, term),
        ilikeFold(orders.phone, term),
      ),
    );
  }

  let offset = filters.offset ?? 0;
  if (filters.cursor) {
    const after = parseOrderCursor(filters.cursor);
    if (after) {
      conditions.push(
        sql`(orders.created_at, orders.id) < (${after.createdAt}, ${after.id})`,
      );
      offset = 0;
    }
  }

  return db
    .select({
      ...getTableColumns(orders),
      wilaya: wilayas.nameAr,
      commune: communes.nameAr,
      driverName: sql<
        string | null
      >`CASE WHEN ${driversAlias.firstName} IS NOT NULL THEN ${driversAlias.firstName} || ' ' || ${driversAlias.lastName} ELSE NULL END`,
      hasReview: sql<number>`EXISTS (SELECT 1 FROM reviews WHERE reviews.order_id = orders.id)`,
      lastUpdatedBy: sql<
        string | null
      >`(SELECT by FROM order_status_history WHERE order_id = orders.id ORDER BY timestamp DESC LIMIT 1)`,
    })
    .from(orders)
    .leftJoin(wilayas, eq(orders.wilayaId, wilayas.id))
    .leftJoin(communes, eq(orders.communeId, communes.id))
    .leftJoin(driversAlias, eq(orders.driverId, driversAlias.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(filters.limit ?? 50)
    .offset(offset)
    ;
}

export async function getOrderById(db: AppDb, orderId: string) {
  const order = await db
    .select({
      ...getTableColumns(orders),
      wilaya: wilayas.nameAr,
      commune: communes.nameAr,
      driverName: sql<
        string | null
      >`CASE WHEN ${driversAlias.firstName} IS NOT NULL THEN ${driversAlias.firstName} || ' ' || ${driversAlias.lastName} ELSE NULL END`,
      labelUrl: companyShipments.labelUrl,
    })
    .from(orders)
    .leftJoin(wilayas, eq(orders.wilayaId, wilayas.id))
    .leftJoin(communes, eq(orders.communeId, communes.id))
    .leftJoin(driversAlias, eq(orders.driverId, driversAlias.id))
    .leftJoin(companyShipments, eq(companyShipments.orderId, orders.id))
    .where(eq(orders.id, orderId))
    .then((rows) => rows[0] ?? null);

  if (!order) return null;

  const [orderProductsList, historyRows] = await Promise.all([
    db.select().from(orderProducts).where(eq(orderProducts.orderId, orderId)),
    db
      .select({
        id: orderStatusHistory.id,
        orderId: orderStatusHistory.orderId,
        status: orderStatusHistory.status,
        timestamp: orderStatusHistory.timestamp,
        by: orderStatusHistory.by,
        byName: users.name,
      })
      .from(orderStatusHistory)
      .leftJoin(users, eq(orderStatusHistory.by, users.id))
      .where(eq(orderStatusHistory.orderId, orderId))
      .orderBy(desc(orderStatusHistory.timestamp)),
  ]);

  return {
    ...order,
    products: orderProductsList,
    statusHistory: historyRows.map((h) => ({
      id: h.id,
      orderId: h.orderId,
      status: h.status,
      timestamp: h.timestamp,
      by: h.by,
      byName: h.byName ?? null,
    })),
  };
}

export async function createOrder(
  db: AppDb,
  orderData: typeof orders.$inferInsert,
  productsData: Array<typeof orderProducts.$inferInsert>,
  actor?: { id: string; name: string } | null,
) {
  const now = orderData.createdAt ?? new Date().toISOString();

  // Atomic via ONE db.batch: order row, lines, history, customer stats, stock
  // deduction, and ledger commit together or not at all (D1 executes a batch
  // as a single transaction). Guarded deductions make the batch fail (and
  // roll back entirely) when stock is insufficient — no silent floor-at-zero,
  // no lost-update races. Reads are hoisted before the batch: D1 has no
  // interactive transactions, and inventory checks re-resolve inside the
  // guarded subselects at write time.
  const tracked = new Map<string, boolean>();
  for (const item of productsData) {
    if (tracked.has(item.productId)) continue;
    const productRow = await db
      .select({ trackInventory: products.trackInventory })
      .from(products)
      .where(eq(products.id, item.productId))
      .then((rows) => rows[0] ?? null);
    tracked.set(item.productId, Boolean(productRow?.trackInventory));
  }

  const stmts: BatchItem<"sqlite">[] = [
    db.insert(orders).values(orderData),
    ...(productsData.length > 0 ? [db.insert(orderProducts).values(productsData)] : []),
    db.insert(orderStatusHistory).values({
      id: crypto.randomUUID(),
      orderId: orderData.id!,
      status: orderData.status!,
      timestamp: orderData.createdAt!,
      by: null,
    }),
    db
      .update(customers)
      .set({
        totalOrders: sql`${customers.totalOrders} + 1`,
        totalSpent: sql`${customers.totalSpent} + ${orderData.price ?? 0}`,
        lastOrderAt: orderData.createdAt,
      })
      .where(eq(customers.id, orderData.customerId)),
  ];

  for (const item of productsData) {
    const qty = item.quantity as number;

    if (!tracked.get(item.productId)) continue;

    // Guarded deduction, same pattern as the storefront path: the movement's
    // qtyBefore/qtyAfter are subselects guarded by inventory >= qty. When
    // stock is insufficient (or a concurrent writer already took it), the
    // subselects return NULL, the movement insert violates NOT NULL, and the
    // ENTIRE batch rolls back — no oversell floor, no lost-update race.
    if (item.variantId) {
      stmts.push(
        db.insert(stockMovements).values({
          id: crypto.randomUUID(),
          productId: item.productId,
          variantId: item.variantId,
          type: "ORDER_DEDUCTED",
          delta: -qty,
          qtyBefore: sql`(SELECT inventory FROM product_variants WHERE id = ${item.variantId} AND inventory >= ${qty})`,
          qtyAfter: sql`(SELECT inventory - ${qty} FROM product_variants WHERE id = ${item.variantId} AND inventory >= ${qty})`,
          reason: null,
          reference: orderData.id ?? null,
          createdBy: actor?.id ?? "system",
          createdByName: actor?.name ?? "النظام",
          createdAt: now,
        }),
        db
          .update(productVariants)
          .set({
            inventory: sql`${productVariants.inventory} - ${qty}`,
            updatedAt: now,
          })
          .where(
            and(
              eq(productVariants.id, item.variantId),
              sql`${productVariants.inventory} >= ${qty}`,
            ),
          ),
      );
    } else {
      stmts.push(
        db.insert(stockMovements).values({
          id: crypto.randomUUID(),
          productId: item.productId,
          variantId: null,
          type: "ORDER_DEDUCTED",
          delta: -qty,
          qtyBefore: sql`(SELECT inventory FROM products WHERE id = ${item.productId} AND inventory >= ${qty})`,
          qtyAfter: sql`(SELECT inventory - ${qty} FROM products WHERE id = ${item.productId} AND inventory >= ${qty})`,
          reason: null,
          reference: orderData.id ?? null,
          createdBy: actor?.id ?? "system",
          createdByName: actor?.name ?? "النظام",
          createdAt: now,
        }),
        db
          .update(products)
          .set({
            inventory: sql`${products.inventory} - ${qty}`,
            updatedAt: now,
          })
          .where(
            and(
              eq(products.id, item.productId),
              sql`${products.inventory} >= ${qty}`,
            ),
          ),
      );
    }
  }

  await batchAll(db, stmts);

  return orderData.id;
}

export async function updateOrderStatus(
  db: AppDb,
  orderId: string,
  newStatus: OrderStatus,
  userId?: string,
  userName?: string,
) {
  const now = new Date().toISOString();

  const order = await db.select().from(orders).where(eq(orders.id, orderId)).then((rows) => rows[0] ?? null);

  // Atomic via ONE db.batch (D1 executes a batch as a single transaction):
  // status, history, driver credit, customer stats, restock, and line
  // returns commit together or not at all. Reads are hoisted before the
  // batch — D1 has no interactive transactions.
  const stmts: BatchItem<"sqlite">[] = [
    db
      .update(orders)
      .set({
        status: newStatus,
        updatedAt: now,
        ...(newStatus === "delivered" ? { deliveryTime: now } : {}),
      })
      .where(eq(orders.id, orderId)),
    db.insert(orderStatusHistory).values({
      id: crypto.randomUUID(),
      orderId,
      status: newStatus,
      timestamp: now,
      by: userId ?? null,
    }),
  ];

  if (newStatus === "delivered" && order?.driverId) {
    stmts.push(
      db
        .update(drivers)
        .set({
          totalDelivered: sql`${drivers.totalDelivered} + 1`,
          totalEarnings: sql`${drivers.totalEarnings} + ${order.driverFee ?? 0}`,
          pendingCash: sql`${drivers.pendingCash} + ${order.codAmount ?? 0}`,
          updatedAt: now,
        })
        .where(eq(drivers.id, order.driverId)),
    );
  }

  const terminalStatuses = ["cancelled", "returned"];
  const wasAlreadyTerminal = order ? terminalStatuses.includes(order.status) : false;

  if (!wasAlreadyTerminal && (newStatus === "cancelled" || newStatus === "returned")) {
    // Update customer totalSpent when order is cancelled/returned
    stmts.push(
      db
        .update(customers)
        .set({
          totalSpent: sql`MAX(0, ${customers.totalSpent} - ${order?.price ?? 0})`,
        })
        .where(eq(customers.id, order?.customerId ?? "")),
    );

    const movementType =
      newStatus === "cancelled" ? "ORDER_CANCELLED" : "ORDER_RETURNED";

    const ordProductRows = await db
      .select({
        id: orderProducts.id,
        productId: orderProducts.productId,
        variantId: orderProducts.variantId,
        quantity: orderProducts.quantity,
        returnedQuantity: orderProducts.returnedQuantity,
      })
      .from(orderProducts)
      .where(eq(orderProducts.orderId, orderId))
      ;

    for (const op of ordProductRows) {
      const remaining = op.quantity - (op.returnedQuantity ?? 0);
      if (remaining <= 0) continue;

      const productRow = await db
        .select({ trackInventory: products.trackInventory })
        .from(products)
        .where(eq(products.id, op.productId))
        .then((rows) => rows[0] ?? null);

      if (!productRow?.trackInventory) continue;

      if (op.variantId) {
        const variantRow = await db
          .select({ inventory: productVariants.inventory })
          .from(productVariants)
          .where(eq(productVariants.id, op.variantId))
          .then((rows) => rows[0] ?? null);

        const qtyBefore = variantRow?.inventory ?? 0;
        const qtyAfter = qtyBefore + remaining;

        stmts.push(
          db
            .update(productVariants)
            .set({ inventory: qtyAfter, updatedAt: now })
            .where(eq(productVariants.id, op.variantId)),
          db.insert(stockMovements).values({
            id: crypto.randomUUID(),
            productId: op.productId,
            variantId: op.variantId,
            type: movementType,
            delta: remaining,
            qtyBefore,
            qtyAfter,
            reason: null,
            reference: orderId,
            createdBy: userId ?? "system",
            createdByName: userName ?? "النظام",
            createdAt: now,
          }),
        );
      } else {
        const productInventoryRow = await db
          .select({ inventory: products.inventory })
          .from(products)
          .where(eq(products.id, op.productId))
          .then((rows) => rows[0] ?? null);

        const qtyBefore = productInventoryRow?.inventory ?? 0;
        const qtyAfter = qtyBefore + remaining;

        stmts.push(
          db
            .update(products)
            .set({ inventory: qtyAfter, updatedAt: now })
            .where(eq(products.id, op.productId)),
          db.insert(stockMovements).values({
            id: crypto.randomUUID(),
            productId: op.productId,
            variantId: null,
            type: movementType,
            delta: remaining,
            qtyBefore,
            qtyAfter,
            reason: null,
            reference: orderId,
            createdBy: userId ?? "system",
            createdByName: userName ?? "النظام",
            createdAt: now,
          }),
        );
      }

      stmts.push(
        db
          .update(orderProducts)
          .set({ status: "returned", returnedQuantity: op.quantity })
          .where(eq(orderProducts.id, op.id)),
      );
    }
  }

  await batchAll(db, stmts);

  return true;
}

export interface UpdateOrderData {
  customerName?: string;
  phone?: string;
  /** null clears the email; undefined leaves it untouched. */
  customerEmail?: string | null;
  wilayaId?: number;
  communeId?: string;
  city?: string | null;
  /** null clears the address; undefined leaves it untouched. */
  address?: string | null;
  deliveryType?: "home" | "stop_desk";
  notes?: string | null;
}

/**
 * Partial edit of an order's customer/destination fields. Identity (id,
 * orderNumber), pricing, and dispatch state are deliberately not patchable —
 * pricing is fixed at creation and post-dispatch edits go through the
 * carrier-aware shipment-operations path.
 *
 * The linked customer record is kept in sync in the same operation: name,
 * phone, wilaya/commune, and address edits flow into `customers`, so an order
 * and its customer never disagree on who they belong to (phone is the
 * customer identity). Only fields this edit actually changes are written.
 * When the corrected phone already belongs to a different customer record,
 * the order is re-pointed to that record instead of hijacking its phone.
 * customerEmail is order-only — customers have no email column.
 */
export async function updateOrder(
  db: AppDb,
  orderId: string,
  updates: UpdateOrderData,
) {
  const current = await db
    .select({
      customerId: orders.customerId,
      customerName: orders.customerName,
      phone: orders.phone,
      wilayaId: orders.wilayaId,
      communeId: orders.communeId,
      address: orders.address,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .then((rows) => rows[0] ?? null);

  const patch: Partial<typeof orders.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };
  if (updates.customerName !== undefined) patch.customerName = updates.customerName;
  if (updates.phone !== undefined) patch.phone = updates.phone;
  if (updates.customerEmail !== undefined) patch.customerEmail = updates.customerEmail;
  if (updates.wilayaId !== undefined) patch.wilayaId = updates.wilayaId;
  if (updates.communeId !== undefined) patch.communeId = updates.communeId;
  if (updates.city !== undefined) patch.city = updates.city;
  if (updates.address !== undefined) patch.address = updates.address;
  if (updates.deliveryType !== undefined) patch.deliveryType = updates.deliveryType;
  if (updates.notes !== undefined) patch.notes = updates.notes;

  const customerUpdates: UpdateCustomerData = {};
  if (current) {
    if (updates.customerName !== undefined && updates.customerName !== current.customerName) {
      customerUpdates.name = updates.customerName;
    }
    if (updates.wilayaId !== undefined && updates.wilayaId !== current.wilayaId) {
      customerUpdates.wilayaId = updates.wilayaId;
    }
    if (updates.communeId !== undefined && updates.communeId !== current.communeId) {
      customerUpdates.communeId = updates.communeId;
    }
    if (updates.address !== undefined && (updates.address ?? null) !== (current.address ?? null)) {
      customerUpdates.address = updates.address ?? null;
    }

    if (updates.phone !== undefined && updates.phone !== current.phone) {
      const phoneOwner = await getCustomerByPhone(db, updates.phone);
      if (phoneOwner && phoneOwner.id !== current.customerId) {
        // The corrected number already identifies another customer record —
        // move the order to it. Only fields this edit changed flow onto it,
        // never the previous customer's identity.
        patch.customerId = phoneOwner.id;
      } else {
        customerUpdates.phone = updates.phone;
      }
    }
  }

  await db.update(orders).set(patch).where(eq(orders.id, orderId));

  const customerTarget = patch.customerId ?? current?.customerId;
  if (customerTarget && Object.keys(customerUpdates).length > 0) {
    await updateCustomer(db, customerTarget, customerUpdates);
  }
}

export async function setOrderProductReturn(
  db: AppDb,
  orderId: string,
  productLineId: string,
  newReturnedQty: number,
  userId?: string,
  userName?: string,
): Promise<{
  id: string;
  status: "fulfilled" | "partially_returned" | "returned";
  returnedQuantity: number;
  quantity: number;
}> {
  const now = new Date().toISOString();

  const line = await db
    .select()
    .from(orderProducts)
    .where(and(eq(orderProducts.id, productLineId), eq(orderProducts.orderId, orderId)))
    .then((rows) => rows[0] ?? null);

  if (!line) {
    throw new Error(`Order line ${productLineId} not found on order ${orderId}`);
  }

  if (newReturnedQty < 0 || newReturnedQty > line.quantity) {
    throw new Error(
      `returnedQuantity must be between 0 and ${line.quantity} (got ${newReturnedQty})`,
    );
  }

  const currentReturned = line.returnedQuantity ?? 0;
  const delta = newReturnedQty - currentReturned;

  if (delta !== 0) {
    const productRow = await db
      .select({ trackInventory: products.trackInventory })
      .from(products)
      .where(eq(products.id, line.productId))
      .then((rows) => rows[0] ?? null);

    if (productRow?.trackInventory) {
      if (line.variantId) {
        const variantRow = await db
          .select({ inventory: productVariants.inventory })
          .from(productVariants)
          .where(eq(productVariants.id, line.variantId))
          .then((rows) => rows[0] ?? null);

        const qtyBefore = variantRow?.inventory ?? 0;
        const qtyAfter = Math.max(0, qtyBefore + delta);

        await db
          .update(productVariants)
          .set({ inventory: qtyAfter, updatedAt: now })
          .where(eq(productVariants.id, line.variantId));

        await db
          .insert(stockMovements)
          .values({
            id: crypto.randomUUID(),
            productId: line.productId,
            variantId: line.variantId,
            type: "ORDER_RETURNED",
            delta,
            qtyBefore,
            qtyAfter,
            reason: null,
            reference: orderId,
            createdBy: userId ?? "system",
            createdByName: userName ?? "النظام",
            createdAt: now,
          })
          .catch((err) =>
            console.error("[stock] Failed to log ORDER_RETURNED movement:", err),
          );
      } else {
        const productInventoryRow = await db
          .select({ inventory: products.inventory })
          .from(products)
          .where(eq(products.id, line.productId))
          .then((rows) => rows[0] ?? null);

        const qtyBefore = productInventoryRow?.inventory ?? 0;
        const qtyAfter = Math.max(0, qtyBefore + delta);

        await db
          .update(products)
          .set({ inventory: qtyAfter, updatedAt: now })
          .where(eq(products.id, line.productId));

        await db
          .insert(stockMovements)
          .values({
            id: crypto.randomUUID(),
            productId: line.productId,
            variantId: null,
            type: "ORDER_RETURNED",
            delta,
            qtyBefore,
            qtyAfter,
            reason: null,
            reference: orderId,
            createdBy: userId ?? "system",
            createdByName: userName ?? "النظام",
            createdAt: now,
          })
          .catch((err) =>
            console.error("[stock] Failed to log ORDER_RETURNED movement:", err),
          );
      }
    }
  }

  const newStatus: "fulfilled" | "partially_returned" | "returned" =
    newReturnedQty === 0
      ? "fulfilled"
      : newReturnedQty === line.quantity
        ? "returned"
        : "partially_returned";

  await db
    .update(orderProducts)
    .set({ status: newStatus, returnedQuantity: newReturnedQty })
    .where(eq(orderProducts.id, productLineId));

  return {
    id: line.id,
    status: newStatus,
    returnedQuantity: newReturnedQty,
    quantity: line.quantity,
  };
}

export async function assignDriver(db: AppDb, orderId: string, driverId: string) {
  const now = new Date().toISOString();

  const order = await db
    .select({ wilayaId: orders.wilayaId, status: orders.status })
    .from(orders)
    .where(eq(orders.id, orderId))
    .then((rows) => rows[0] ?? null);

  let driverFee = 0;
  if (order?.wilayaId) {
    const comp = await db
      .select({ feePerDelivery: driverCompensations.feePerDelivery })
      .from(driverCompensations)
      .where(
        and(
          eq(driverCompensations.driverId, driverId),
          eq(driverCompensations.wilayaId, order.wilayaId),
        ),
      )
      .then((rows) => rows[0] ?? null);

    if (comp) {
      driverFee = comp.feePerDelivery;
    }
  }

  const preAssignmentStatuses = ["new", "preparing", "ready"];
  const shouldSetAssigned = preAssignmentStatuses.includes(order?.status ?? "");

  await db
    .update(orders)
    .set({
      driverId,
      driverFee,
      deliveryMethod: "driver",
      ...(shouldSetAssigned ? { status: "assigned" } : {}),
      updatedAt: now,
    })
    .where(eq(orders.id, orderId));

  return true;
}

export async function unassignDriver(db: AppDb, orderId: string) {
  const now = new Date().toISOString();

  const order = await db
    .select({ status: orders.status })
    .from(orders)
    .where(eq(orders.id, orderId))
    .then((rows) => rows[0] ?? null);

  const shouldRollbackStatus = order?.status === "assigned";

  await db
    .update(orders)
    .set({
      driverId: null,
      driverFee: 0,
      deliveryMethod: "unassigned",
      ...(shouldRollbackStatus ? { status: "ready" } : {}),
      updatedAt: now,
    })
    .where(eq(orders.id, orderId));

  return true;
}

export async function assignCompany(db: AppDb, orderId: string, companyId: string) {
  await db
    .update(orders)
    .set({
      companyId,
      deliveryMethod: "company",
      updatedAt: new Date().toISOString(),
    })
    .where(eq(orders.id, orderId));
}

export async function syncOrderAfterCarrierUpdate(
  db: AppDb,
  orderId: string,
  fields: { customerName?: string; phone?: string; price?: number },
) {
  const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (fields.customerName !== undefined) patch.customerName = fields.customerName;
  if (fields.phone !== undefined) patch.phone = fields.phone;
  if (fields.price !== undefined) {
    patch.price = fields.price;
    // The COD the driver is booked to collect must follow the carrier
    // amount — leaving codAmount stale made settlement and dashboards run
    // on the old number while the carrier collected the new one.
    patch.codAmount = sql`${fields.price} + ${orders.deliveryFee}`;
  }

  await db.update(orders).set(patch).where(eq(orders.id, orderId));
}

export async function updateOrderTracking(
  db: AppDb,
  orderId: string,
  trackingNumber: string,
  trackingUrl?: string,
  deliveryType?: "home" | "stop_desk",
) {
  await db
    .update(orders)
    .set({
      trackingNumber,
      trackingUrl: trackingUrl ?? null,
      // Dispatch-time delivery-type override: persisted only on successful
      // dispatch so the order records what the carrier actually accepted.
      ...(deliveryType !== undefined ? { deliveryType } : {}),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(orders.id, orderId));
}

export async function clearOrderTracking(db: AppDb, orderId: string) {
  await db
    .update(orders)
    .set({
      trackingNumber: null,
      trackingUrl: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(orders.id, orderId));
}

export async function deleteOrder(db: AppDb, orderId: string) {
  const now = new Date().toISOString();

  // Get order details first to update customer stats
  const order = await db.select().from(orders).where(eq(orders.id, orderId)).then((rows) => rows[0] ?? null);

  // Get order products to restore inventory
  const orderProductsList = await db
    .select()
    .from(orderProducts)
    .where(eq(orderProducts.orderId, orderId))
    ;

  // Atomic via ONE db.batch (D1 executes a batch as a single transaction):
  // stats, restock, and deletes commit together or not at all. Reads are
  // hoisted before the batch — D1 has no interactive transactions.
  const stmts: BatchItem<"sqlite">[] = [];

  // Update customer stats BEFORE deleting the order.
  // totalOrders always drops (the order no longer exists). totalSpent is only
  // subtracted when the order was still counting as spend: cancelled/returned
  // orders already rolled their spend back at status-change time —
  // subtracting again would double-decrement (e.g. cancel + delete).
  if (order) {
    const spendAlreadyRolledBack =
      order.status === "cancelled" || order.status === "returned";

    stmts.push(
      db
        .update(customers)
        .set({
          totalOrders: sql`MAX(0, ${customers.totalOrders} - 1)`,
          ...(spendAlreadyRolledBack
            ? {}
            : {
                totalSpent: sql`MAX(0, ${customers.totalSpent} - ${order.price ?? 0})`,
              }),
        })
        .where(eq(customers.id, order.customerId)),
    );
  }

  // Reverse driver credit for delivered orders whose money has NOT been
  // settled. Before this, deleting a delivered order left totalDelivered,
  // totalEarnings and pendingCash permanently inflated — and unsettleable
  // phantom cash (the order no longer appears in the pending list).
  // Orders already linked to a payment keep the driver counters alone:
  // the payment row is append-only history and must stay reconciled.
  if (order && order.driverId && order.status === "delivered" && order.codPaymentId === null) {
    stmts.push(
      db
        .update(drivers)
        .set({
          totalDelivered: sql`MAX(0, ${drivers.totalDelivered} - 1)`,
          totalEarnings: sql`MAX(0, ${drivers.totalEarnings} - ${order.driverFee ?? 0})`,
          pendingCash: sql`MAX(0, ${drivers.pendingCash} - ${order.codAmount ?? 0})`,
          updatedAt: now,
        })
        .where(eq(drivers.id, order.driverId)),
    );
  }

  // Restore inventory for products that track inventory
  for (const op of orderProductsList) {
    const remaining = op.quantity - (op.returnedQuantity ?? 0);
    if (remaining <= 0) continue; // Already returned, no stock to restore

    const productRow = await db
      .select({ trackInventory: products.trackInventory })
      .from(products)
      .where(eq(products.id, op.productId))
      .then((rows) => rows[0] ?? null);

    if (!productRow?.trackInventory) continue; // Product doesn't track inventory

    if (op.variantId) {
      // Restore variant inventory
      const variantRow = await db
        .select({ inventory: productVariants.inventory })
        .from(productVariants)
        .where(eq(productVariants.id, op.variantId))
        .then((rows) => rows[0] ?? null);

      const qtyBefore = variantRow?.inventory ?? 0;
      const qtyAfter = qtyBefore + remaining;

      stmts.push(
        db
          .update(productVariants)
          .set({ inventory: qtyAfter, updatedAt: now })
          .where(eq(productVariants.id, op.variantId)),
        db.insert(stockMovements).values({
          id: crypto.randomUUID(),
          productId: op.productId,
          variantId: op.variantId,
          type: "ORDER_CANCELLED",
          delta: remaining,
          qtyBefore,
          qtyAfter,
          reason: "Order deleted - inventory restored",
          reference: orderId,
          createdBy: "system",
          createdByName: "النظام",
          createdAt: now,
        }),
      );
    } else {
      // Restore product inventory
      const productInventoryRow = await db
        .select({ inventory: products.inventory })
        .from(products)
        .where(eq(products.id, op.productId))
        .then((rows) => rows[0] ?? null);

      const qtyBefore = productInventoryRow?.inventory ?? 0;
      const qtyAfter = qtyBefore + remaining;

      stmts.push(
        db
          .update(products)
          .set({ inventory: qtyAfter, updatedAt: now })
          .where(eq(products.id, op.productId)),
        db.insert(stockMovements).values({
          id: crypto.randomUUID(),
          productId: op.productId,
          variantId: null,
          type: "ORDER_CANCELLED",
          delta: remaining,
          qtyBefore,
          qtyAfter,
          reason: "Order deleted - inventory restored",
          reference: orderId,
          createdBy: "system",
          createdByName: "النظام",
          createdAt: now,
        }),
      );
    }
  }

  // Delete related records. company_api_logs, webhook_events, capi_event_log
  // and tiktok_event_log reference orders(id) with ON DELETE no action —
  // they must be removed explicitly or the final orders delete fails the
  // FOREIGN KEY constraint. Reviews and order_status_history cascade at the
  // database level.
  stmts.push(
    db.delete(companyApiLogs).where(eq(companyApiLogs.orderId, orderId)),
    db.delete(webhookEvents).where(eq(webhookEvents.orderId, orderId)),
    db.delete(capiEventLog).where(eq(capiEventLog.orderId, orderId)),
    db.delete(tiktokEventLog).where(eq(tiktokEventLog.orderId, orderId)),
    db.delete(companyShipments).where(eq(companyShipments.orderId, orderId)),
    db.delete(orderProducts).where(eq(orderProducts.orderId, orderId)),
    db.delete(orders).where(eq(orders.id, orderId)),
  );

  await batchAll(db, stmts);
}

// ─── Webhook Status Update ────────────────────────────────────────────────────

/**
 * Rank used to guard against webhook-driven status regressions.
 * A webhook event can only advance the order to a higher-ranked status.
 * Delivered, returned, and cancelled are all terminal (rank 6) — no further changes.
 */
const STATUS_RANK: Record<string, number> = {
  new: 0,
  confirmed: 1,
  unreachable: 1,
  no_answer_1: 1,
  no_answer_2: 1,
  no_answer_3: 1,
  preparing: 2,
  ready: 3,
  assigned: 4,
  out_for_delivery: 5,
  delivered: 6,
  returned: 6,
  cancelled: 6,
};

interface RestockLine {
  lineId: string;
  productId: string;
  variantId: string | null;
  remaining: number;
}

interface RestockResolved extends RestockLine {
  qtyBefore: number;
}

async function resolveRestockLines(
  db: AppDb,
  orderId: string,
): Promise<RestockLine[]> {
  const ordProductRows = await db
    .select({
      id: orderProducts.id,
      productId: orderProducts.productId,
      variantId: orderProducts.variantId,
      quantity: orderProducts.quantity,
      returnedQuantity: orderProducts.returnedQuantity,
    })
    .from(orderProducts)
    .where(eq(orderProducts.orderId, orderId))
    ;

  const lines: RestockLine[] = [];
  for (const op of ordProductRows) {
    const remaining = op.quantity - (op.returnedQuantity ?? 0);
    if (remaining <= 0) continue;

    const productRow = await db
      .select({ trackInventory: products.trackInventory })
      .from(products)
      .where(eq(products.id, op.productId))
      .then((rows) => rows[0] ?? null);

    if (!productRow?.trackInventory) continue;

    lines.push({
      lineId: op.id,
      productId: op.productId,
      variantId: op.variantId,
      remaining,
    });
  }
  return lines;
}

async function readCurrentInventories(
  db: AppDb,
  lines: RestockLine[],
): Promise<RestockResolved[]> {
  const resolved: RestockResolved[] = [];
  for (const line of lines) {
    const row = await db
      .select({ inventory: line.variantId ? productVariants.inventory : products.inventory })
      .from(line.variantId ? productVariants : products)
      .where(eq(line.variantId ? productVariants.id : products.id, line.variantId ?? line.productId))
      .then((rows) => rows[0] ?? null);
    resolved.push({ ...line, qtyBefore: row?.inventory ?? 0 });
  }
  return resolved;
}

export async function updateOrderStatusWebhook(
  db: AppDb,
  orderId: string,
  newStatus: OrderStatus,
  source: string,
): Promise<{ updated: boolean }> {
  const now = new Date().toISOString();

  const order = await db.select().from(orders).where(eq(orders.id, orderId)).then((rows) => rows[0] ?? null);

  if (!order) return { updated: false };

  const currentRank = STATUS_RANK[order.status] ?? 0;
  const newRank = STATUS_RANK[newStatus] ?? 0;

  if (newRank <= currentRank) {
    return { updated: false };
  }

  const updateFields: Record<string, unknown> = {
    status: newStatus,
    updatedAt: now,
  };
  if (newStatus === "delivered") {
    updateFields.deliveryTime = now;
  }

  const movementType =
    newStatus === "cancelled" ? "ORDER_CANCELLED" : "ORDER_RETURNED";
  const needsRestock = newStatus === "cancelled" || newStatus === "returned";
  const lines = needsRestock ? await resolveRestockLines(db, orderId) : [];
  const resolved = needsRestock ? await readCurrentInventories(db, lines) : [];

  await batchAll(db, [
    db.update(orders).set(updateFields).where(eq(orders.id, orderId)),
    db.insert(orderStatusHistory).values({
      id: crypto.randomUUID(),
      orderId,
      status: newStatus,
      timestamp: now,
      by: source,
    }),
    ...(newStatus === "delivered" && order.driverId
      ? [
          db
            .update(drivers)
            .set({
              totalDelivered: sql`${drivers.totalDelivered} + 1`,
              totalEarnings: sql`${drivers.totalEarnings} + ${order.driverFee ?? 0}`,
              pendingCash: sql`${drivers.pendingCash} + ${order.codAmount ?? 0}`,
              updatedAt: now,
            })
            .where(eq(drivers.id, order.driverId)),
        ]
      : []),
    ...(needsRestock
      ? [
          db
            .update(customers)
            .set({
              totalSpent: sql`MAX(0, ${customers.totalSpent} - ${order.price ?? 0})`,
            })
            .where(eq(customers.id, order.customerId)),
        ]
      : []),
    ...(needsRestock
      ? resolved.flatMap((line) => {
          const qtyAfter = line.qtyBefore + line.remaining;
          const restock = line.variantId
            ? db
                .update(productVariants)
                .set({ inventory: sql`${productVariants.inventory} + ${line.remaining}`, updatedAt: now })
                .where(eq(productVariants.id, line.variantId))
            : db
                .update(products)
                .set({ inventory: sql`${products.inventory} + ${line.remaining}`, updatedAt: now })
                .where(eq(products.id, line.productId));
          return [
            restock,
            db.insert(stockMovements).values({
              id: crypto.randomUUID(),
              productId: line.productId,
              variantId: line.variantId,
              type: movementType,
              delta: line.remaining,
              qtyBefore: line.qtyBefore,
              qtyAfter,
              reason: null,
              reference: orderId,
              createdBy: source,
              createdByName: source,
              createdAt: now,
            }),
            db
              .update(orderProducts)
              .set({ status: "returned", returnedQuantity: sql`${orderProducts.quantity}` })
              .where(eq(orderProducts.id, line.lineId)),
          ];
        })
      : []),
  ]);

  return { updated: true };
}

export async function updateOrderInternalNote(
  db: AppDb,
  orderId: string,
  internalNote: string | null,
) {
  await db
    .update(orders)
    .set({
      internalNote,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(orders.id, orderId));
}

export async function incrementDeliveryAttempts(
  db: AppDb,
  orderId: string,
): Promise<void> {
  await db
    .update(orders)
    .set({
      deliveryAttempts: sql`${orders.deliveryAttempts} + 1`,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(orders.id, orderId));
}

// ─── Order Edit (dashboard) ─────────────────────────────────────────────────

export const EDITABLE_ORDER_STATUSES = [
  "new",
  "confirmed",
  "unreachable",
  "no_answer_1",
  "no_answer_2",
  "no_answer_3",
  "preparing",
  "ready",
  "assigned",
] as const;

export const LOCKED_ORDER_STATUSES = [
  "dispatched",
  "out_for_delivery",
  "delivered",
  "returned",
  "cancelled",
] as const;

export interface UpdateOrderLineInput {
  productId: string;
  productName: string;
  variantId?: string | null;
  variantLabel?: string | null;
  quantity: number;
  pricePerUnit: number;
}

export interface UpdateOrderDetailsInput {
  customerName?: string;
  phone?: string;
  /** null clears the email; undefined leaves it untouched. */
  customerEmail?: string | null;
  wilayaId?: number;
  communeId?: string;
  city?: string | null;
  address?: string | null;
  deliveryType?: "home" | "stop_desk";
  deliveryFee?: number;
  notes?: string | null;
  price?: number;
  products?: UpdateOrderLineInput[];
}

function orderLineKey(productId: string, variantId: string | null | undefined): string {
  return `${productId}|${variantId ?? ""}`;
}

export async function updateOrderDetails(
  db: AppDb,
  orderId: string,
  input: UpdateOrderDetailsInput,
  actor?: { id: string; name: string } | null,
) {
  const now = new Date().toISOString();
  const orderRow = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .then((rows) => rows[0] ?? null);
  if (!orderRow) {
    const err = new Error("Order not found") as Error & { code?: string };
    err.code = "NOT_FOUND";
    throw err;
  }
  if (orderRow.trackingNumber) {
    const err = new Error("Order already dispatched — edit the shipment instead") as Error & {
      code?: string;
      context?: Record<string, unknown>;
    };
    err.code = "ORDER_ALREADY_DISPATCHED";
    err.context = { orderId };
    throw err;
  }
  if ((LOCKED_ORDER_STATUSES as readonly string[]).includes(orderRow.status)) {
    const err = new Error(
      `Cannot edit an order in "${orderRow.status}" status`,
    ) as Error & { code?: string; context?: Record<string, unknown> };
    err.code = "INVALID_STATUS_TRANSITION";
    err.context = { orderId, currentStatus: orderRow.status };
    throw err;
  }

  const existingLines = await db
    .select()
    .from(orderProducts)
    .where(eq(orderProducts.orderId, orderId));

  let nextLines: Array<{
    id: string;
    orderId: string;
    productId: string;
    productName: string;
    variantId: string | null;
    variantLabel: string | null;
    quantity: number;
    pricePerUnit: number;
    lineTotal: number;
    createdAt: string;
  }> | null = null;
  let nextPrice = orderRow.price as number;

  if (input.products) {
    const lockedLine = existingLines.find(
      (line) => (line.returnedQuantity ?? 0) > 0 || line.status !== "fulfilled",
    );
    if (lockedLine) {
      const err = new Error(
        "Products cannot be edited after a return was recorded on this order",
      ) as Error & { code?: string };
      err.code = "ORDER_LINES_LOCKED";
      throw err;
    }
    // Validate products / variants exist before touching stock.
    for (const line of input.products) {
      const productRow = await db
        .select({ id: products.id, trackInventory: products.trackInventory })
        .from(products)
        .where(eq(products.id, line.productId))
        .then((rows) => rows[0] ?? null);
      if (!productRow) {
        const err = new Error(`Product not found: ${line.productId}`) as Error & {
          code?: string;
        };
        err.code = "PRODUCT_NOT_FOUND";
        throw err;
      }
      if (line.variantId) {
        const variantRow = await db
          .select({ id: productVariants.id })
          .from(productVariants)
          .where(eq(productVariants.id, line.variantId))
          .then((rows) => rows[0] ?? null);
        if (!variantRow) {
          const err = new Error(`Variant not found: ${line.variantId}`) as Error & {
            code?: string;
          };
          err.code = "VARIANT_NOT_FOUND";
          throw err;
        }
      }
    }
    nextLines = input.products.map((line) => ({
      id: crypto.randomUUID(),
      orderId,
      productId: line.productId,
      productName: line.productName,
      variantId: line.variantId ?? null,
      variantLabel: line.variantLabel ?? null,
      quantity: line.quantity,
      pricePerUnit: line.pricePerUnit,
      lineTotal: line.pricePerUnit * line.quantity,
      createdAt: now,
    }));
    const linesTotal = nextLines.reduce((sum, line) => sum + line.lineTotal, 0);
    nextPrice = input.price ?? linesTotal;
  } else if (input.price !== undefined) {
    nextPrice = input.price;
  }

  if (input.wilayaId !== undefined) {
    const wilayaRow = await db
      .select({ id: wilayas.id })
      .from(wilayas)
      .where(eq(wilayas.id, input.wilayaId))
      .then((rows) => rows[0] ?? null);
    if (!wilayaRow) {
      const err = new Error("Wilaya not found") as Error & { code?: string };
      err.code = "WILAYA_NOT_FOUND";
      throw err;
    }
  }
  if (input.communeId !== undefined) {
    const communeRow = await db
      .select({ id: communes.id })
      .from(communes)
      .where(eq(communes.id, input.communeId))
      .then((rows) => rows[0] ?? null);
    if (!communeRow) {
      const err = new Error("Commune not found") as Error & { code?: string };
      err.code = "COMMUNE_NOT_FOUND";
      throw err;
    }
  }

  const effectiveDeliveryType = input.deliveryType ?? (orderRow.deliveryType as "home" | "stop_desk");
  const effectiveAddress = input.address !== undefined ? input.address : (orderRow.address as string | null);
  if (effectiveDeliveryType === "home" && !effectiveAddress?.trim()) {
    const err = new Error("Address is required for home delivery") as Error & { code?: string };
    err.code = "ADDRESS_REQUIRED";
    throw err;
  }

  const nextDeliveryFee = input.deliveryFee ?? (orderRow.deliveryFee as number);
  const nextCodAmount = nextPrice + nextDeliveryFee;
  const priceDelta = nextPrice - (orderRow.price as number);

  const patch: Partial<typeof orders.$inferInsert> = {
    updatedAt: now,
    price: nextPrice,
    deliveryFee: nextDeliveryFee,
    codAmount: nextCodAmount,
  };
  if (input.customerName !== undefined) patch.customerName = input.customerName.trim();
  if (input.phone !== undefined) patch.phone = input.phone.trim();
  if (input.customerEmail !== undefined) patch.customerEmail = input.customerEmail;
  if (input.wilayaId !== undefined) patch.wilayaId = input.wilayaId;
  if (input.communeId !== undefined) patch.communeId = input.communeId;
  if (input.city !== undefined) patch.city = input.city || null;
  if (input.address !== undefined) patch.address = input.address || null;
  if (input.deliveryType !== undefined) patch.deliveryType = input.deliveryType;
  if (input.notes !== undefined) patch.notes = input.notes?.trim() ? input.notes.trim() : null;

  // Atomic via ONE db.batch (D1 executes a batch as a single transaction).
  // Reads are hoisted before the batch — D1 has no interactive transactions.
  const stmts: BatchItem<"sqlite">[] = [];
  if (nextLines) {
    const oldQty = new Map<string, number>();
    for (const line of existingLines) {
      const key = orderLineKey(line.productId, line.variantId);
      oldQty.set(key, (oldQty.get(key) ?? 0) + (line.quantity as number));
    }
    const newQty = new Map<string, { qty: number; productId: string; variantId: string | null }>();
    for (const line of nextLines!) {
      const key = orderLineKey(line.productId, line.variantId);
      const prev = newQty.get(key);
      newQty.set(key, {
        qty: (prev?.qty ?? 0) + line.quantity,
        productId: line.productId,
        variantId: line.variantId,
      });
    }
    const keys = new Set([...oldQty.keys(), ...newQty.keys()]);
    for (const key of keys) {
      const before = oldQty.get(key) ?? 0;
      const after = newQty.get(key);
      const delta = (after?.qty ?? 0) - before;
      if (delta === 0) continue;
      const productId = after?.productId ?? existingLines.find((l) => orderLineKey(l.productId, l.variantId) === key)!.productId;
      const variantId = after?.variantId ?? existingLines.find((l) => orderLineKey(l.productId, l.variantId) === key)!.variantId ?? null;
      const productRow = await db
        .select({ trackInventory: products.trackInventory })
        .from(products)
        .where(eq(products.id, productId))
        .then((rows) => rows[0] ?? null);
      if (!productRow?.trackInventory) continue;
      if (delta > 0) {
        if (variantId) {
          stmts.push(
            db.insert(stockMovements).values({
              id: crypto.randomUUID(),
              productId,
              variantId,
              type: "ORDER_DEDUCTED",
              delta: -delta,
              qtyBefore: sql`(SELECT inventory FROM product_variants WHERE id = ${variantId} AND inventory >= ${delta})`,
              qtyAfter: sql`(SELECT inventory - ${delta} FROM product_variants WHERE id = ${variantId} AND inventory >= ${delta})`,
              reason: "Order edited - extra quantity deducted",
              reference: orderId,
              createdBy: actor?.id ?? "system",
              createdByName: actor?.name ?? "System",
              createdAt: now,
            }),
            db
              .update(productVariants)
              .set({ inventory: sql`${productVariants.inventory} - ${delta}`, updatedAt: now })
              .where(and(eq(productVariants.id, variantId), sql`${productVariants.inventory} >= ${delta}`)),
          );
        } else {
          stmts.push(
            db.insert(stockMovements).values({
              id: crypto.randomUUID(),
              productId,
              variantId: null,
              type: "ORDER_DEDUCTED",
              delta: -delta,
              qtyBefore: sql`(SELECT inventory FROM products WHERE id = ${productId} AND inventory >= ${delta})`,
              qtyAfter: sql`(SELECT inventory - ${delta} FROM products WHERE id = ${productId} AND inventory >= ${delta})`,
              reason: "Order edited - extra quantity deducted",
              reference: orderId,
              createdBy: actor?.id ?? "system",
              createdByName: actor?.name ?? "System",
              createdAt: now,
            }),
            db
              .update(products)
              .set({ inventory: sql`${products.inventory} - ${delta}`, updatedAt: now })
              .where(and(eq(products.id, productId), sql`${products.inventory} >= ${delta}`)),
          );
        }
      } else {
        const restore = -delta;
        if (variantId) {
          const variantRow = await db
            .select({ inventory: productVariants.inventory })
            .from(productVariants)
            .where(eq(productVariants.id, variantId))
            .then((rows) => rows[0] ?? null);
          const qtyBefore = variantRow?.inventory ?? 0;
          stmts.push(
            db
              .update(productVariants)
              .set({ inventory: qtyBefore + restore, updatedAt: now })
              .where(eq(productVariants.id, variantId)),
            db.insert(stockMovements).values({
              id: crypto.randomUUID(),
              productId,
              variantId,
              type: "ORDER_CANCELLED",
              delta: restore,
              qtyBefore,
              qtyAfter: qtyBefore + restore,
              reason: "Order edited - quantity restored",
              reference: orderId,
              createdBy: actor?.id ?? "system",
              createdByName: actor?.name ?? "System",
              createdAt: now,
            }),
          );
        } else {
          const productInventoryRow = await db
            .select({ inventory: products.inventory })
            .from(products)
            .where(eq(products.id, productId))
            .then((rows) => rows[0] ?? null);
          const qtyBefore = productInventoryRow?.inventory ?? 0;
          stmts.push(
            db
              .update(products)
              .set({ inventory: qtyBefore + restore, updatedAt: now })
              .where(eq(products.id, productId)),
            db.insert(stockMovements).values({
              id: crypto.randomUUID(),
              productId,
              variantId: null,
              type: "ORDER_CANCELLED",
              delta: restore,
              qtyBefore,
              qtyAfter: qtyBefore + restore,
              reason: "Order edited - quantity restored",
              reference: orderId,
              createdBy: actor?.id ?? "system",
              createdByName: actor?.name ?? "System",
              createdAt: now,
            }),
          );
        }
      }
    }
    stmts.push(
      db.delete(orderProducts).where(eq(orderProducts.orderId, orderId)),
      db.insert(orderProducts).values(nextLines),
    );
  }

  stmts.push(db.update(orders).set(patch).where(eq(orders.id, orderId)));

  if (priceDelta !== 0) {
    stmts.push(
      db
        .update(customers)
        .set({ totalSpent: sql`${customers.totalSpent} + ${priceDelta}` })
        .where(eq(customers.id, orderRow.customerId)),
    );
  }

  await batchAll(db, stmts);

  return { price: nextPrice, deliveryFee: nextDeliveryFee, codAmount: nextCodAmount };
}
