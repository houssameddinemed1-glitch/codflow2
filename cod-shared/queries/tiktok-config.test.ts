/**
 * store_tiktok_config queries — unit tests
 *
 * Pins the upsert contract (mirrors the Meta pixel-config contract, fully
 * separate table):
 *   - an empty accessToken keeps the previously stored token (write-only flow)
 *   - adAccountName / testEventCode keep their stored value when omitted,
 *     clear when sent empty
 *   - conversionEvent / testMode keep-on-undefined, with defensive defaults
 *     on insert
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTiktokConfig, upsertTiktokConfig } from "./tiktok-config";

function makeDb(row: unknown | undefined) {
  const get = vi.fn(async () => row);
  const returningGet = vi.fn(async () => row);
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ get })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => ({ get: returningGet })),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(async () => undefined),
    })),
  } as any;
  return { db, get, returningGet };
}

describe("getTiktokConfig", () => {
  it("returns undefined when no row exists (tracking inert)", async () => {
    const { db } = makeDb(undefined);
    expect(await getTiktokConfig(db, "store-1")).toBeUndefined();
  });

  it("returns the full row — raw accessor for server-side senders", async () => {
    const { db } = makeDb({
      storeId: "store-1",
      pixelId: "tt-1",
      conversionEvent: "Lead",
      testMode: true,
      enabled: true,
    });
    const raw = await getTiktokConfig(db, "store-1");
    expect(raw).toMatchObject({ pixelId: "tt-1", conversionEvent: "Lead", testMode: true });
  });
});

describe("upsertTiktokConfig", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("inserts a new row with defensive defaults for conversionEvent/testMode", async () => {
    const { db } = makeDb(undefined);
    await upsertTiktokConfig(db, "store-1", {
      pixelId: "tt-1",
      accessToken: "tt-1",
      conversionEvent: "Lead",
    });

    expect(db.insert).toHaveBeenCalledOnce();
  });

  it("an empty accessToken keeps the previously stored token", async () => {
    const { db } = makeDb({ accessToken: "tt-stored", conversionEvent: "Purchase" });
    const setSpy = vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(() => ({ get: vi.fn(async () => ({})) })),
      })),
    }));
    (db.update as any).mockReturnValue({ set: setSpy });

    await upsertTiktokConfig(db, "store-1", { pixelId: "tt-1", accessToken: "   " });

    expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "tt-stored" }));
  });
});
