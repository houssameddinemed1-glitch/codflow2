/**
 * Re-exported from cod-shared/queries/landing-pages so the dashboard can
 * consume the same read functions directly from D1.
 *
 * createLandingPage/updateLandingPage wrappers stay here because they raise
 * BusinessLogicError / ConflictError: product existence, slug uniqueness,
 * and the delete-with-orders guard turn raw DB crashes into friendly errors.
 */
import { eq } from "drizzle-orm";
import { products } from "@/db/schema";
import type { AppDb } from "@/db";
import { BusinessLogicError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors/classes";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import * as shared from "../../../../cod-shared/queries/landing-pages";

export * from "../../../../cod-shared/queries/landing-pages";

type CreateLandingPageData = Parameters<typeof shared.createLandingPage>[1];
type UpdateLandingPageData = Parameters<typeof shared.updateLandingPage>[2];

function isLpUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Error &&
    /UNIQUE constraint failed: landing_pages\.slug/i.test(err.message)
  );
}

export async function createLandingPage(db: AppDb, data: CreateLandingPageData) {
  // The product must exist — a landing page without its product is unusable.
  const product = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.id, data.productId))
    .then((rows) => rows[0] ?? null);
  if (!product) {
    throw new NotFoundError("Product", data.productId);
  }

  const kind = data.kind ?? "single";
  const productIds = data.productIds ?? [];
  if (kind === "multi") {
    if (productIds.length === 0) {
      throw new ValidationError(
        "A multi landing page needs at least one product",
        ERROR_CODES.VALIDATION_FAILED,
        { kind },
      );
    }
    await assertProductsExist(db, productIds);
  } else if (productIds.length > 0) {
    throw new ValidationError(
      "productIds is only accepted for multi landing pages",
      ERROR_CODES.VALIDATION_FAILED,
      { kind },
    );
  }

  // Slug uniqueness is a friendly 409, not a raw constraint crash.
  if (data.slug && (await shared.slugExists(db, data.slug))) {
    throw new ConflictError(
      `Slug "${data.slug}" is already used by another landing page`,
      ERROR_CODES.DUPLICATE_ENTITY,
      { slug: data.slug },
    );
  }

  try {
    return await shared.createLandingPage(db, data);
  } catch (err) {
    // Race: a concurrent writer took the slug between check and insert.
    if (isLpUniqueViolation(err)) {
      throw new ConflictError(
        `Slug "${data.slug}" is already used by another landing page`,
        ERROR_CODES.DUPLICATE_ENTITY,
        { slug: data.slug },
      );
    }
    throw err;
  }
}

export async function updateLandingPage(
  db: AppDb,
  id: string,
  data: UpdateLandingPageData,
) {
  const existing = await shared.getLandingPageById(db, id);
  if (!existing) throw new NotFoundError("Landing Page", id);

  if (data.slug && data.slug !== existing.slug) {
    if (await shared.slugExists(db, data.slug)) {
      throw new ConflictError(
        `Slug "${data.slug}" is already used by another landing page`,
        ERROR_CODES.DUPLICATE_ENTITY,
        { slug: data.slug },
      );
    }
  }

  try {
    await shared.updateLandingPage(db, id, data);
  } catch (err) {
    if (data.slug && isLpUniqueViolation(err)) {
      throw new ConflictError(
        `Slug "${data.slug}" is already used by another landing page`,
        ERROR_CODES.DUPLICATE_ENTITY,
        { slug: data.slug },
      );
    }
    throw err;
  }
}

export async function deleteLandingPageWithGuard(db: AppDb, id: string) {
  const existing = await shared.getLandingPageById(db, id);
  if (!existing) throw new NotFoundError("Landing Page", id);

  const orderCount = await shared.countLandingPageOrders(db, id);
  if (orderCount > 0) {
    throw new BusinessLogicError(
      "Cannot delete a landing page with attributed orders — archive it instead so history stays intact",
      ERROR_CODES.LANDING_PAGE_HAS_ORDERS,
      { landingPageId: id, orderCount },
    );
  }

  await shared.deleteLandingPage(db, id);
}

export async function reorderLandingPageImagesChecked(
  db: AppDb,
  landingPageId: string,
  imageIds: string[],
) {
  const existing = await shared.getLandingPageImages(db, landingPageId);
  const existingIds = new Set(existing.map((img) => img.id));

  if (new Set(imageIds).size !== imageIds.length) {
    throw new ValidationError(
      "imageIds must not contain duplicates",
      ERROR_CODES.VALIDATION_FAILED,
      { received: imageIds.length },
    );
  }
  for (const imageId of imageIds) {
    if (!existingIds.has(imageId)) {
      throw new ValidationError(
        `Image ${imageId} does not belong to landing page ${landingPageId}`,
        ERROR_CODES.VALIDATION_FAILED,
        { imageId, landingPageId },
      );
    }
  }
  if (imageIds.length !== existing.length) {
    throw new ValidationError(
      "imageIds must include all images for this landing page",
      ERROR_CODES.VALIDATION_FAILED,
      { expected: existing.length, received: imageIds.length },
    );
  }

  return shared.reorderLandingPageImages(db, landingPageId, imageIds);
}

async function assertProductsExist(db: AppDb, productIds: string[]) {
  const missing: string[] = [];
  for (const productId of new Set(productIds)) {
    const row = await db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.id, productId))
      .then((rows) => rows[0] ?? null);
    if (!row) missing.push(productId);
  }
  if (missing.length > 0) {
    throw new NotFoundError("Product", missing[0]);
  }
}

async function getMultiPage(db: AppDb, landingPageId: string) {
  const page = await shared.getLandingPageById(db, landingPageId);
  if (!page) throw new NotFoundError("Landing Page", landingPageId);
  if (page.kind !== "multi") {
    throw new ValidationError(
      "Product picks are only managed on multi landing pages",
      ERROR_CODES.VALIDATION_FAILED,
      { landingPageId, kind: page.kind },
    );
  }
  return page;
}

export async function setLandingPageProductsChecked(
  db: AppDb,
  landingPageId: string,
  productIds: string[],
) {
  const page = await getMultiPage(db, landingPageId);
  if (productIds.length === 0) {
    throw new ValidationError(
      "A multi landing page needs at least one product",
      ERROR_CODES.VALIDATION_FAILED,
      { landingPageId },
    );
  }
  await assertProductsExist(db, productIds);
  const rows = await shared.setLandingPageProducts(db, landingPageId, productIds);
  const first = rows[0]?.productId;
  if (first && first !== page.productId) {
    await shared.updateLandingPageCover(db, landingPageId, first);
  }
  return rows;
}

export async function addLandingPageProductChecked(
  db: AppDb,
  landingPageId: string,
  productId: string,
) {
  await getMultiPage(db, landingPageId);
  await assertProductsExist(db, [productId]);
  return shared.addLandingPageProduct(db, landingPageId, productId);
}

export async function removeLandingPageProductChecked(
  db: AppDb,
  landingPageId: string,
  productId: string,
) {
  const page = await getMultiPage(db, landingPageId);
  const remaining = page.productIds.filter((id) => id !== productId);
  if (remaining.length === 0) {
    throw new ValidationError(
      "A multi landing page needs at least one product — add a replacement before removing this one",
      ERROR_CODES.VALIDATION_FAILED,
      { landingPageId },
    );
  }
  await shared.removeLandingPageProduct(db, landingPageId, productId);
  if (page.productId === productId && remaining[0] !== page.productId) {
    await shared.updateLandingPageCover(db, landingPageId, remaining[0]);
  }
  return shared.getLandingPageProducts(db, landingPageId);
}

export async function reorderLandingPageProductsChecked(
  db: AppDb,
  landingPageId: string,
  productIds: string[],
) {
  const page = await getMultiPage(db, landingPageId);

  if (new Set(productIds).size !== productIds.length) {
    throw new ValidationError(
      "productIds must not contain duplicates",
      ERROR_CODES.VALIDATION_FAILED,
      { received: productIds.length },
    );
  }
  const existing = new Set(page.productIds);
  for (const productId of productIds) {
    if (!existing.has(productId)) {
      throw new ValidationError(
        `Product ${productId} is not picked on landing page ${landingPageId}`,
        ERROR_CODES.VALIDATION_FAILED,
        { productId, landingPageId },
      );
    }
  }
  if (productIds.length !== page.productIds.length) {
    throw new ValidationError(
      "productIds must include all picked products for this landing page",
      ERROR_CODES.VALIDATION_FAILED,
      { expected: page.productIds.length, received: productIds.length },
    );
  }

  return shared.reorderLandingPageProducts(db, landingPageId, productIds);
}
