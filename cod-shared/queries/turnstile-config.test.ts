/**
 * store_turnstile_config queries — unit tests
 *
 * Pins the safe-default contract the whole feature rests on:
 *   no row → the feature is inert, and the secret key never leaves the raw
 *   accessor (the site key is public by design and IS in the safe projection).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getTurnstileConfig,
  getTurnstileConfigRaw,
  upsertTurnstileConfig,
} from "./turnstile-config";

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

describe("getTurnstileConfig", () => {
  it("returns null when no row exists (feature inert)", async () => {
    const { db } = makeDb(undefined);
    expect(await getTurnstileConfig(db, "store-1")).toBeNull();
  });

  it("returns the safe projection — siteKey exposed, secretKey never", async () => {
    const { db } = makeDb({
      storeId: "store-1",
      siteKey: "0x4AAA-site",
      enabled: true,
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
    });
    const config = await getTurnstileConfig(db, "store-1");
    expect(config).toMatchObject({ storeId: "store-1", siteKey: "0x4AAA-site", enabled: true });
    expect(JSON.stringify(config)).not.toContain("secretKey");
    expect(JSON.stringify(config)).not.toContain("secret_key");
  });
});

describe("getTurnstileConfigRaw", () => {
  it("returns the full row including the secret (server-side callers only)", async () => {
    const { db } = makeDb({
      storeId: "store-1",
      siteKey: "0x4AAA-site",
      secretKey: "0x4AAA-secret",
      enabled: true,
    });
    const raw = await getTurnstileConfigRaw(db, "store-1");
    expect(raw?.secretKey).toBe("0x4AAA-secret");
  });
});

describe("upsertTurnstileConfig", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("inserts a new row (enabled default true) and returns the safe shape", async () => {
    const { db } = makeDb(undefined);
    db.select = vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => thenRows(undefined)),
      })),
    })) as any;

    const result = await upsertTurnstileConfig(db, "store-1", {
      siteKey: "0x4AAA-site",
      secretKey: "0x4AAA-secret",
    });

    expect(db.insert).toHaveBeenCalledOnce();
    const valuesCall = (db.insert.mock.results[0].value as any).values.mock.calls[0][0];
    expect(valuesCall).toMatchObject({
      storeId: "store-1",
      siteKey: "0x4AAA-site",
      secretKey: "0x4AAA-secret",
      enabled: true,
    });
    expect(result).toMatchObject({ storeId: "store-1", siteKey: "0x4AAA-site", enabled: true });
    expect(JSON.stringify(result)).not.toContain("0x4AAA-secret");
  });

  it("updates an existing row instead of inserting", async () => {
    const { db, returning } = makeDb({
      storeId: "store-1",
      siteKey: "old-site",
      enabled: false,
      createdAt: "t",
      updatedAt: "t2",
    });
    db.select = vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => thenRows({ id: "row-1" })),
      })),
    })) as any;

    const result = await upsertTurnstileConfig(db, "store-1", {
      siteKey: "new-site",
      secretKey: "new-secret",
      enabled: false,
    });

    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).toHaveBeenCalledOnce();
    // The update payload carries both keys and the enabled flag.
    const setCall = (db.update.mock.results[0].value as any).set.mock.calls[0][0];
    expect(setCall).toMatchObject({
      siteKey: "new-site",
      secretKey: "new-secret",
      enabled: false,
    });
    expect(returning).toHaveBeenCalled();
    // Returned shape is the safe projection — no secret.
    expect(JSON.stringify(result)).not.toContain("new-secret");
  });
});
