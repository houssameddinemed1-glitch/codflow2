/**
 * Multi-product ("smart") landing pages — unit tests for the wrapper guards.
 *
 * Pins the contracts the storefront grid depends on:
 *   • create: multi requires a non-empty pick list of existing products;
 *     single rejects productIds outright.
 *   • picks can only be managed on multi pages (single → VALIDATION_FAILED).
 *   • the last pick cannot be removed; reorder needs the complete set.
 *   • removing/reordering the cover pick advances the cover to the new first.
 *
 * The shared queries module is mocked (raw DB ops); the pg-thenable db mock
 * serves only the product-existence reads the wrapper performs itself.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const shared = vi.hoisted(() => ({
  slugExists: vi.fn(async () => false),
  getLandingPageById: vi.fn(),
  createLandingPage: vi.fn(async () => ({ id: "lp-1", slug: "lp-abc" })),
  setLandingPageProducts: vi.fn(),
  addLandingPageProduct: vi.fn(),
  removeLandingPageProduct: vi.fn(),
  getLandingPageProducts: vi.fn(),
  reorderLandingPageProducts: vi.fn(),
  updateLandingPageCover: vi.fn(async () => undefined),
}));

vi.mock("../../../../cod-shared/queries/landing-pages", () => shared);

import {
  createLandingPage,
  setLandingPageProductsChecked,
  addLandingPageProductChecked,
  removeLandingPageProductChecked,
  reorderLandingPageProductsChecked,
} from "./queries";
import { createLandingPageSchema } from "./validation";

/** pg-convention mock: select() serves queued rows; writes never run here. */
function makeDb(rows: unknown[] = []) {
  const queue = [...rows];
  const chain = (): any => {
    const value = queue.shift();
    const resolved = value === undefined ? [] : Array.isArray(value) ? value : [value];
    const c: any = {
      from: () => c,
      where: () => c,
      then: (resolve: (v: unknown) => void) => resolve(resolved),
    };
    return c;
  };
  return { select: vi.fn(() => chain()) } as any;
}

const PRODUCT = { id: "prod-1" };
const PRODUCT_2 = { id: "prod-2" };

function multiPage(overrides = {}) {
  return {
    id: "lp-1",
    slug: "lp-abc",
    name: "Multi",
    productId: "prod-1",
    kind: "multi",
    productIds: ["prod-1", "prod-2"],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  shared.slugExists.mockResolvedValue(false);
});

describe("createLandingPage (multi)", () => {
  it("accepts kind + productIds in validation", () => {
    const data = createLandingPageSchema.parse({
      name: "Smart page",
      productId: "prod-1",
      kind: "multi",
      productIds: ["prod-1", "prod-2"],
    });
    expect(data.kind).toBe("multi");
    expect(data.productIds).toEqual(["prod-1", "prod-2"]);
  });

  it("refuses a multi page with no picks", async () => {
    const db = makeDb([PRODUCT]);
    await expect(
      createLandingPage(db, { name: "Smart", productId: "prod-1", kind: "multi", productIds: [] } as any),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(shared.createLandingPage).not.toHaveBeenCalled();
  });

  it("refuses productIds on a single page", async () => {
    const db = makeDb([PRODUCT]);
    await expect(
      createLandingPage(db, { name: "Single", productId: "prod-1", productIds: ["prod-1"] } as any),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(shared.createLandingPage).not.toHaveBeenCalled();
  });

  it("refuses an unknown picked product", async () => {
    const db = makeDb([PRODUCT]);
    await expect(
      createLandingPage(db, {
        name: "Smart",
        productId: "prod-1",
        kind: "multi",
        productIds: ["prod-1", "prod-missing"],
      } as any),
    ).rejects.toMatchObject({ name: "NotFoundError" });
    expect(shared.createLandingPage).not.toHaveBeenCalled();
  });

  it("creates a multi page when every pick exists", async () => {
    const db = makeDb([PRODUCT, PRODUCT, PRODUCT_2]);
    const result = await createLandingPage(db, {
      name: "Smart",
      productId: "prod-1",
      kind: "multi",
      productIds: ["prod-1", "prod-2"],
    } as any);
    expect(result).toEqual({ id: "lp-1", slug: "lp-abc" });
    expect(shared.createLandingPage).toHaveBeenCalledOnce();
  });
});

describe("pick guards", () => {
  it("set/add/remove/reorder refuse single pages", async () => {
    shared.getLandingPageById.mockResolvedValue(multiPage({ kind: "single", productIds: [] }));
    const db = makeDb();
    await expect(setLandingPageProductsChecked(db, "lp-1", ["prod-1"])).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(addLandingPageProductChecked(db, "lp-1", "prod-1")).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(removeLandingPageProductChecked(db, "lp-1", "prod-1")).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(reorderLandingPageProductsChecked(db, "lp-1", ["prod-1"])).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });

  it("refuses to remove the last pick", async () => {
    shared.getLandingPageById.mockResolvedValue(multiPage({ productIds: ["prod-1"] }));
    const db = makeDb();
    await expect(removeLandingPageProductChecked(db, "lp-1", "prod-1")).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    expect(shared.removeLandingPageProduct).not.toHaveBeenCalled();
  });

  it("advances the cover when the cover pick is removed", async () => {
    shared.getLandingPageById.mockResolvedValue(multiPage());
    shared.getLandingPageProducts.mockResolvedValue([{ productId: "prod-2" }]);
    const db = makeDb();
    await removeLandingPageProductChecked(db, "lp-1", "prod-1");
    expect(shared.updateLandingPageCover).toHaveBeenCalledWith(expect.anything(), "lp-1", "prod-2");
  });

  it("refuses an incomplete reorder set", async () => {
    shared.getLandingPageById.mockResolvedValue(multiPage());
    const db = makeDb();
    await expect(reorderLandingPageProductsChecked(db, "lp-1", ["prod-1"])).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    expect(shared.reorderLandingPageProducts).not.toHaveBeenCalled();
  });

  it("advances the cover on set when the first pick changes", async () => {
    shared.getLandingPageById.mockResolvedValue(multiPage());
    shared.setLandingPageProducts.mockResolvedValue([{ productId: "prod-2" }, { productId: "prod-1" }]);
    const db = makeDb([PRODUCT_2, PRODUCT, PRODUCT_2, PRODUCT]);
    await setLandingPageProductsChecked(db, "lp-1", ["prod-2", "prod-1"]);
    expect(shared.updateLandingPageCover).toHaveBeenCalledWith(expect.anything(), "lp-1", "prod-2");
  });
});
