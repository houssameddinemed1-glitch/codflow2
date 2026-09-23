/**
 * store_otp_config queries + config exposure — unit tests
 *
 * Pins the safe-default contract the whole feature rests on:
 *   no row → otpEnabled=false, and the API key never leaves the raw accessor.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getOtpConfig,
  getOtpConfigRaw,
  upsertOtpConfig,
} from "./otp-config";

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

describe("getOtpConfig", () => {
  it("returns null when no row exists (feature inert)", async () => {
    const { db } = makeDb(undefined);
    expect(await getOtpConfig(db, "store-1")).toBeNull();
  });

  it("returns the safe projection — apiKey is not selected", async () => {
    const { db } = makeDb({
      storeId: "store-1",
      language: "ar",
      enabled: true,
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
    });
    const config = await getOtpConfig(db, "store-1");
    expect(config).toMatchObject({ storeId: "store-1", enabled: true, language: "ar" });
    expect(JSON.stringify(config)).not.toContain("apiKey");
    expect(JSON.stringify(config)).not.toContain("api_key");
  });
});

describe("getOtpConfigRaw", () => {
  it("returns the full row including the API key (server-side callers only)", async () => {
    const { db } = makeDb({
      storeId: "store-1",
      apiKey: "dz-secret",
      language: "ar",
      enabled: true,
    });
    const raw = await getOtpConfigRaw(db, "store-1");
    expect(raw?.apiKey).toBe("dz-secret");
  });
});

describe("upsertOtpConfig", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("inserts a new row with defaults (ar, enabled) and returns the safe shape", async () => {
    const existing = undefined;
    const { db } = makeDb(undefined);
    db.select = vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => thenRows(existing)),
      })),
    })) as any;

    const result = await upsertOtpConfig(db, "store-1", { apiKey: "dz-key" });

    expect(db.insert).toHaveBeenCalledOnce();
    const valuesCall = (db.insert.mock.results[0].value as any).values.mock.calls[0][0];
    expect(valuesCall).toMatchObject({ storeId: "store-1", apiKey: "dz-key", language: "ar", enabled: true });
    expect(result).toMatchObject({ storeId: "store-1", language: "ar", enabled: true });
    expect(JSON.stringify(result)).not.toContain("dz-key");
  });

  it("updates an existing row instead of inserting", async () => {
    const { db, returning } = makeDb({
      storeId: "store-1",
      language: "en",
      enabled: false,
      createdAt: "t",
      updatedAt: "t2",
    });
    db.select = vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => thenRows({ id: "row-1" })),
      })),
    })) as any;

    const result = await upsertOtpConfig(db, "store-1", {
      apiKey: "new-key",
      language: "en",
      enabled: false,
    });

    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ enabled: false, language: "en" });
    expect(returning).toHaveBeenCalled();
  });
});
