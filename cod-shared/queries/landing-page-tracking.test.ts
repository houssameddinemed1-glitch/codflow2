/**
 * Landing-page tracking queries â€” unit tests (Node, no D1).
 *
 * Pins the write-only token contract and the row lifecycle with a
 * programmable mock db. Cascade deletes and landing-page duplication ride on
 * real foreign keys plus `duplicateLandingPage` â€” covered where those live.
 */

import { describe, it, expect, vi } from "vitest";
import {
  deleteLandingPageTracking,
  getLandingPageTracking,
  lastCapiEventForLandingPage,
  upsertLandingPageTracking,
} from "./landing-page-tracking";

/** pg-convention mock: builders are thenables; capture writes for assertions. */
function makeDb(rows: unknown[] = []) {
  const queue = [...rows];
  const writes: Array<{ op: string; values: unknown }> = [];
  const chain = (): any => {
    const value = queue.shift();
    const resolved = value === undefined ? [] : Array.isArray(value) ? value : [value];
    const c: any = {
      from: () => c,
      where: () => c,
      innerJoin: () => c,
      orderBy: () => c,
      limit: () => c,
      set: (v: unknown) => {
        writes.push({ op: "set", values: v });
        return c;
      },
      values: (v: unknown) => {
        writes.push({ op: "values", values: v });
        return c;
      },
      returning: () => c,
      then: (resolve: (v: unknown) => void) => resolve(resolved),
    };
    return c;
  };
  const db = {
    select: vi.fn(() => chain()),
    update: vi.fn(() => chain()),
    insert: vi.fn(() => chain()),
    delete: vi.fn(() => chain()),
  } as any;
  return { db, writes };
}

describe("getLandingPageTracking", () => {
  it("returns null for a page that inherits the store pixel", async () => {
    const { db } = makeDb([]);
    expect(await getLandingPageTracking(db, "lp-1")).toBeNull();
  });

  it("returns the page's own row once one exists", async () => {
    const row = { id: "t-1", landingPageId: "lp-1", pixelId: "999" };
    const { db } = makeDb([row]);
    expect(await getLandingPageTracking(db, "lp-1")).toEqual(row);
  });
});

describe("upsertLandingPageTracking", () => {
  it("creates a row with the merchant's choices and safe defaults", async () => {
    const { db, writes } = makeDb([]);
    await upsertLandingPageTracking(db, "lp-1", {
      pixelId: "123",
      accessToken: "EAAG-1",
      conversionEvent: "Purchase",
    });
    const values = writes.find((w) => w.op === "values")?.values as Record<string, unknown>;
    expect(values.pixelId).toBe("123");
    expect(values.accessToken).toBe("EAAG-1");
    expect(values.testMode).toBe(false);
    expect(values.enabled).toBe(true);
  });

  it("keeps the stored token when the field comes back empty", async () => {
    const { db, writes } = makeDb([
      { id: "t-1", accessToken: "EAAG-stored", conversionEvent: "Purchase", testMode: false, enabled: true },
    ]);
    await upsertLandingPageTracking(db, "lp-1", { pixelId: "123" });
    const set = writes.find((w) => w.op === "set")?.values as Record<string, unknown>;
    expect(set.accessToken).toBe("EAAG-stored");
  });

  it("replaces the token when a new one is typed", async () => {
    const { db, writes } = makeDb([
      { id: "t-1", accessToken: "EAAG-stored", conversionEvent: "Purchase", testMode: false, enabled: true },
    ]);
    await upsertLandingPageTracking(db, "lp-1", { pixelId: "123", accessToken: "EAAG-new" });
    const set = writes.find((w) => w.op === "set")?.values as Record<string, unknown>;
    expect(set.accessToken).toBe("EAAG-new");
  });

  it("keeps the ad account label and test code when omitted, clears them when blanked", async () => {
    const stored = {
      id: "t-1",
      accessToken: "EAAG-stored",
      adAccountName: "Old label",
      testEventCode: "OLD-CODE",
      conversionEvent: "Purchase",
      testMode: false,
      enabled: true,
    };
    const { db: dbKeep, writes: writesKeep } = makeDb([stored]);
    await upsertLandingPageTracking(dbKeep, "lp-1", { pixelId: "123" });
    const kept = writesKeep.find((w) => w.op === "set")?.values as Record<string, unknown>;
    expect(kept.adAccountName).toBe("Old label");
    expect(kept.testEventCode).toBe("OLD-CODE");

    const { db: dbClear, writes: writesClear } = makeDb([stored]);
    await upsertLandingPageTracking(dbClear, "lp-1", {
      pixelId: "123",
      adAccountName: "",
      testEventCode: "",
    });
    const cleared = writesClear.find((w) => w.op === "set")?.values as Record<string, unknown>;
    expect(cleared.adAccountName).toBeNull();
    expect(cleared.testEventCode).toBeNull();
  });
});

describe("deleteLandingPageTracking", () => {
  it("returns the page to the store pixel", async () => {
    const { db } = makeDb([{ id: "t-1" }]);
    await deleteLandingPageTracking(db, "lp-1");
    expect(db.delete).toHaveBeenCalled();
  });

  it("is safe on a page that never had an override", async () => {
    const { db } = makeDb([]);
    await expect(deleteLandingPageTracking(db, "lp-1")).resolves.toBeUndefined();
  });
});

describe("lastCapiEventForLandingPage", () => {
  it("returns the most recent event row for the page's orders", async () => {
    const row = { eventName: "Purchase", stage: "delivered", status: "sent", pixelId: "123", error: null, sentAt: "2026-09-01T00:00:00Z" };
    const { db } = makeDb([row]);
    expect(await lastCapiEventForLandingPage(db, "lp-1")).toEqual(row);
  });

  it("returns null when the page never sold", async () => {
    const { db } = makeDb([]);
    expect(await lastCapiEventForLandingPage(db, "lp-1")).toBeNull();
  });
});
