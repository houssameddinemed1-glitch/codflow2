/**
 * store_tiktok_config queries — unit tests
 *
 * Pins the upsert contract (mirrors the Meta pixel contract):
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
      pixelId: "123",
      conversionEvent: "Lead",
      testMode: true,
      enabled: true,
    });
    const raw = await getTiktokConfig(db, "store-1");
    expect(raw).toMatchObject({ pixelId: "123", conversionEvent: "Lead", testMode: true });
  });
});

describe("upsertTiktokConfig", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("inserts a new row with defensive defaults for conversionEvent/testMode", async () => {
    const { db } = makeDb(undefined);
    await upsertTiktokConfig(db, "store-1", {
      pixelId: "123",
      accessToken: "TT-1",
      conversionEvent: "Lead",
    });

    expect(db.insert).toHaveBeenCalledOnce();
    const valuesCall = (db.insert.mock.results[0].value as any).values.mock.calls[0][0];
    expect(valuesCall).toMatchObject({
      storeId: "store-1",
      pixelId: "123",
      accessToken: "TT-1",
      conversionEvent: "Lead",
      testMode: false,
      enabled: true,
    });
  });

  it("keeps the stored token when accessToken is empty (write-only token flow)", async () => {
    const { db } = makeDb({
      id: "row-1",
      accessToken: "TT-stored",
      adAccountName: "Main Account",
      testEventCode: "KEEP",
      conversionEvent: "Purchase",
      testMode: false,
      enabled: true,
    });

    await upsertTiktokConfig(db, "store-1", {
      pixelId: "123",
      accessToken: "",
      conversionEvent: "Purchase",
    });

    const setCall = (db.update.mock.results[0].value as any).set.mock.calls[0][0];
    expect(setCall.accessToken).toBe("TT-stored");
  });

  it("keeps adAccountName and testEventCode when omitted, clears them when sent empty", async () => {
    const { db } = makeDb({
      id: "row-1",
      accessToken: "TT-stored",
      adAccountName: "Main Account",
      testEventCode: "KEEP",
      conversionEvent: "Purchase",
      testMode: true,
      enabled: true,
    });

    await upsertTiktokConfig(db, "store-1", {
      pixelId: "123",
      conversionEvent: "Purchase",
    });
    let setCall = (db.update.mock.results[0].value as any).set.mock.calls[0][0];
    expect(setCall.adAccountName).toBe("Main Account");
    expect(setCall.testEventCode).toBe("KEEP");
    expect(setCall.testMode).toBe(true);

    await upsertTiktokConfig(db, "store-1", {
      pixelId: "123",
      adAccountName: "",
      testEventCode: "",
      conversionEvent: "Lead",
    });
    setCall = (db.update.mock.results[1].value as any).set.mock.calls[0][0];
    expect(setCall.adAccountName).toBeNull();
    expect(setCall.testEventCode).toBeNull();
    expect(setCall.conversionEvent).toBe("Lead");
  });

  it("stores a trimmed adAccountName and testEventCode", async () => {
    const { db } = makeDb(undefined);
    await upsertTiktokConfig(db, "store-1", {
      pixelId: "123",
      adAccountName: "  Somer Ads  ",
      testEventCode: "  TEST123  ",
      conversionEvent: "Lead",
    });
    const valuesCall = (db.insert.mock.results[0].value as any).values.mock.calls[0][0];
    expect(valuesCall.adAccountName).toBe("Somer Ads");
    expect(valuesCall.testEventCode).toBe("TEST123");
  });

  it("replaces the token when a new one is provided", async () => {
    const { db } = makeDb({
      id: "row-1",
      accessToken: "TT-old",
      conversionEvent: "Purchase",
    });

    await upsertTiktokConfig(db, "store-1", {
      pixelId: "123",
      accessToken: "TT-new ",
      conversionEvent: "Purchase",
    });

    const setCall = (db.update.mock.results[0].value as any).set.mock.calls[0][0];
    expect(setCall.accessToken).toBe("TT-new");
  });
});
