import { eq } from "drizzle-orm";
import { products, productVariants, orderProducts, stockMovements } from "../db/schema.pg";
import type { PgDb } from "../db/client.pg";

export interface CreateVariantData {
  variations: Record<string, string>;
  price: number;
  compareAtPrice?: number | null;
  sku: string;
  barcode?: string | null;
  inventory: number;
  lowStockThreshold?: number;
  weightKg?: number | null;
  imageId?: string | null;
  isDefault: boolean;
  active: boolean;
  position: number;
}

export interface UpdateVariantData {
  variations?: Record<string, string>;
  price?: number;
  compareAtPrice?: number | null;
  sku?: string;
  barcode?: string | null;
  inventory?: number;
  lowStockThreshold?: number;
  weightKg?: number | null;
  imageId?: string | null;
  isDefault?: boolean;
  active?: boolean;
  position?: number;
}

function parseVariant(v: typeof productVariants.$inferSelect) {
  return { ...v, variations: JSON.parse(v.variations) as Record<string, string> };
}

/**
 * Ledger discipline: every tracked-SKU inventory change writes a movement row.
 * Catalog edits (create/update/delete) previously mutated inventory with no
 * ledger entry, so the movement log stopped reconciling to real stock.
 * The activity log records WHO edited; the stock ledger records the math.
 */
function movementValues(
  input: {
    productId: string;
    variantId: string | null;
    delta: number;
    qtyBefore: number;
    qtyAfter: number;
    reason: string;
  },
) {
  return {
    id: crypto.randomUUID(),
    productId: input.productId,
    variantId: input.variantId,
    type: (input.delta > 0 ? "ADJUSTMENT_ADD" : "ADJUSTMENT_REMOVE") as "ADJUSTMENT_ADD" | "ADJUSTMENT_REMOVE",
    delta: input.delta,
    qtyBefore: input.qtyBefore,
    qtyAfter: input.qtyAfter,
    reason: input.reason,
    reference: null,
    createdBy: "system",
    createdByName: "النظام",
    createdAt: new Date().toISOString(),
  };
}

export async function getVariantsByProduct(db: PgDb, productId: string) {
  const variants = await db
    .select()
    .from(productVariants)
    .where(eq(productVariants.productId, productId))
    .orderBy(productVariants.position)
    ;
  return variants.map(parseVariant);
}

export async function getVariantById(db: PgDb, variantId: string) {
  const v = await db.select().from(productVariants).where(eq(productVariants.id, variantId)).then((rows) => rows[0] ?? null);
  return v ? parseVariant(v) : null;
}

export async function createVariant(db: PgDb, productId: string, data: CreateVariantData) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    await tx.insert(productVariants).values({
      id,
      productId,
      variations: JSON.stringify(data.variations),
      currency: "DZD",
      price: data.price,
      compareAtPrice: data.compareAtPrice ?? null,
      sku: data.sku ?? null,
      barcode: data.barcode ?? null,
      inventory: data.inventory,
      lowStockThreshold: data.lowStockThreshold ?? 5,
      weightKg: data.weightKg ?? null,
      imageId: data.imageId ?? null,
      isDefault: data.isDefault,
      active: data.active,
      position: data.position,
      createdAt: now,
      updatedAt: now,
    });

    // Opening stock enters the ledger for tracked products — the audit trail
    // must reconcile to inventory from the variant's first day.
    if (data.inventory > 0) {
      const productRow = await tx
        .select({ trackInventory: products.trackInventory })
        .from(products)
        .where(eq(products.id, productId))
        .then((rows) => rows[0] ?? null);
      if (productRow?.trackInventory) {
        await tx.insert(stockMovements).values(movementValues({
          productId,
          variantId: id,
          delta: data.inventory,
          qtyBefore: 0,
          qtyAfter: data.inventory,
          reason: "Opening stock — variant created",
        }));
      }
    }
  });

  return getVariantById(db, id);
}

export async function updateVariant(db: PgDb, variantId: string, data: UpdateVariantData) {
  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };

  if (data.variations !== undefined) updates.variations = JSON.stringify(data.variations);
  if (data.price !== undefined) updates.price = data.price;
  if (data.compareAtPrice !== undefined) updates.compareAtPrice = data.compareAtPrice ?? null;
  if (data.sku !== undefined) updates.sku = data.sku ?? null;
  if (data.barcode !== undefined) updates.barcode = data.barcode ?? null;
  if (data.inventory !== undefined) updates.inventory = data.inventory;
  if (data.lowStockThreshold !== undefined) updates.lowStockThreshold = data.lowStockThreshold;
  if (data.weightKg !== undefined) updates.weightKg = data.weightKg ?? null;
  if (data.imageId !== undefined) updates.imageId = data.imageId ?? null;
  if (data.isDefault !== undefined) updates.isDefault = data.isDefault;
  if (data.active !== undefined) updates.active = data.active;
  if (data.position !== undefined) updates.position = data.position;

  await db.transaction(async (tx) => {
    // Read BEFORE writing: the movement delta is measured against the
    // pre-edit value. Reading after the update would see the new value and
    // compute a zero delta, silently dropping the ledger entry.
    let movement: ReturnType<typeof movementValues> | null = null;
    if (data.inventory !== undefined) {
      const variantRow = await tx
        .select({ productId: productVariants.productId, inventory: productVariants.inventory })
        .from(productVariants)
        .where(eq(productVariants.id, variantId))
        .then((rows) => rows[0] ?? null);
      if (variantRow) {
        const productRow = await tx
          .select({ trackInventory: products.trackInventory })
          .from(products)
          .where(eq(products.id, variantRow.productId))
          .then((rows) => rows[0] ?? null);
        if (productRow?.trackInventory) {
          const qtyBefore = variantRow.inventory;
          const delta = data.inventory - qtyBefore;
          if (delta !== 0) {
            movement = movementValues({
              productId: variantRow.productId,
              variantId,
              delta,
              qtyBefore,
              qtyAfter: data.inventory,
              reason: "Variant inventory edited",
            });
          }
        }
      }
    }

    await tx.update(productVariants).set(updates).where(eq(productVariants.id, variantId));
    if (movement) await tx.insert(stockMovements).values(movement);
  });
  return getVariantById(db, variantId);
}

export async function deleteVariant(db: PgDb, variantId: string) {
  // Preserve order history — null out the reference rather than blocking deletion.
  const variantRow = await db
    .select({ productId: productVariants.productId, inventory: productVariants.inventory })
    .from(productVariants)
    .where(eq(productVariants.id, variantId))
    .then((rows) => rows[0] ?? null);

  // No ledger surrogate for the deletion: stock_movements.variant_id is
  // ON DELETE cascade, so the variant's scoped movements (including its
  // opening stock) leave with the row. Σ(movements) stays reconciled to the
  // tracked pool; a productId-level -N row would double-count against the
  // vanished +N. The atomic transaction still guarantees the null-out and the
  // delete commit together.
  await db.transaction(async (tx) => {
    await tx.update(orderProducts).set({ variantId: null }).where(eq(orderProducts.variantId, variantId));
    await tx.delete(productVariants).where(eq(productVariants.id, variantId));
  });
  return { success: true };
}
