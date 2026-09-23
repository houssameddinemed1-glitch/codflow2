/**
 * store_form_config queries — unit tests
 *
 * Pins the upsert contract: one row per store, variant kept verbatim,
 * insert with timestamps on first save.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { getFormConfig, upsertFormConfig } from "./form-config";

/** pg-convention mock: drizzle builders are thenables resolving to row arrays. */
function thenRows(row: unknown) {
  const rows = row === undefined ? [] : [row];
  return { then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(rows).then(resolve) };
}

function makeDb(row: unknown | undefined) {
  const returning = vi.fn(() => thenRows(row));
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => thenRows(row)),
        limit: vi.fn(() => thenRows(row)),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning,
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(async () => undefined),
    })),
  } as any;
  return { db, returning };
}

describe("getFormConfig", () => {
  it("returns null when no row exists (Default form)", async () => {
    const { db } = makeDb(undefined);
    expect(await getFormConfig(db, "store-1")).toBeNull();
  });

  it("returns the stored variant", async () => {
    const { db } = makeDb({ storeId: "store-1", variant: "form_a" });
    const raw = await getFormConfig(db, "store-1");
    expect(raw).toMatchObject({ variant: "form_a" });
  });
});

describe("upsertFormConfig", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("inserts a new row on first save", async () => {
    const { db } = makeDb(undefined);
    await upsertFormConfig(db, "store-1", { variant: "form_a" });

    expect(db.insert).toHaveBeenCalledOnce();
  });

  it("updates the variant on later saves", async () => {
    const { db } = makeDb({ variant: "form_a" });
    const setSpy = vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(() => thenRows({})),
      })),
    }));
    (db.update as any).mockReturnValue({ set: setSpy });

    await upsertFormConfig(db, "store-1", { variant: "default" });

    expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({ variant: "default" }));
  });
});
