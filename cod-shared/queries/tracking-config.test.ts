/**
 * Tracking-config precedence — unit tests (Node, no D1).
 *
 * The pure precedence rule plus `resolve*` against a thenable mock db.
 * Every branch but the last lands on today's behaviour, so the matrix below
 * is the feature's safety case in miniature.
 */

import { describe, it, expect, vi } from "vitest";
import {
  effectiveTrackingFrom,
  overrideApplies,
  publicTrackingFrom,
  resolvePublicTracking,
  resolveTrackingConfig,
  type PageConfigRow,
  type StoreConfigRow,
} from "./tracking-config";

function chain(value: unknown): any {
  const rows = value === undefined ? [] : [value];
  const c: any = {
    from: () => c,
    where: () => c,
    then: (resolve: (v: unknown) => void) => resolve(rows),
  };
  return c;
}

function makeDb(values: unknown[]) {
  const queue = [...values];
  const db = { select: vi.fn(() => chain(queue.shift())) } as any;
  return db;
}

const STORE: StoreConfigRow = {
  pixelId: "111",
  accessToken: "EAAG-store",
  conversionEvent: "Purchase",
  testMode: false,
  testEventCode: null,
  enabled: true,
  perPageTrackingEnabled: true,
};

const PAGE: PageConfigRow = {
  pixelId: "222",
  accessToken: "EAAG-page",
  conversionEvent: "Lead",
  testMode: false,
  testEventCode: null,
  enabled: true,
};

describe("overrideApplies", () => {
  it("needs the store on, the master switch on, and a live page pixel", () => {
    expect(overrideApplies(STORE, PAGE)).toBe(true);
    expect(overrideApplies({ ...STORE, enabled: false }, PAGE)).toBe(false);
    expect(overrideApplies({ ...STORE, perPageTrackingEnabled: false }, PAGE)).toBe(false);
    expect(overrideApplies(STORE, { ...PAGE, enabled: false })).toBe(false);
    expect(overrideApplies(STORE, { ...PAGE, pixelId: "" })).toBe(false);
    expect(overrideApplies(null, PAGE)).toBe(false);
    expect(overrideApplies(STORE, null)).toBe(false);
  });
});

describe("effectiveTrackingFrom", () => {
  it("returns null with no store row", () => {
    expect(effectiveTrackingFrom(null, PAGE)).toBeNull();
  });

  it("lands on the store row for every non-override branch", () => {
    expect(effectiveTrackingFrom(STORE, null)?.pixelId).toBe("111");
    expect(effectiveTrackingFrom({ ...STORE, perPageTrackingEnabled: false }, PAGE)?.pixelId).toBe("111");
    expect(effectiveTrackingFrom({ ...STORE, enabled: false }, PAGE)?.pixelId).toBe("111");
  });

  it("lands on the page row when the override applies", () => {
    expect(effectiveTrackingFrom(STORE, PAGE)?.pixelId).toBe("222");
  });
});

describe("publicTrackingFrom", () => {
  it("is null-pixel when disabled or unconfigured", () => {
    expect(publicTrackingFrom({ ...STORE, enabled: false }, null)).toEqual({
      pixelId: null,
      conversionEvent: "Purchase",
    });
    expect(publicTrackingFrom(null, null).pixelId).toBeNull();
  });

  it("carries the id but never the token", () => {
    const pub = publicTrackingFrom(STORE, null);
    expect(pub.pixelId).toBe("111");
    expect(pub).not.toHaveProperty("accessToken");
  });
});

describe("resolveTrackingConfig", () => {
  it("returns null with no store row and costs one read", async () => {
    const db = makeDb([undefined]);
    expect(await resolveTrackingConfig(db, { storeId: "s-1" })).toBeNull();
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it("resolves the store pixel with no landing page", async () => {
    const db = makeDb([STORE]);
    expect((await resolveTrackingConfig(db, { storeId: "s-1" }))?.pixelId).toBe("111");
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it("reads the page row only for landing pages on opted-in stores", async () => {
    const db = makeDb([STORE, PAGE]);
    const config = await resolveTrackingConfig(db, { storeId: "s-1", landingPageId: "lp-1" });
    expect(config?.pixelId).toBe("222");
    expect(db.select).toHaveBeenCalledTimes(2);
  });

  it("skips the second read when the master switch is off", async () => {
    const db = makeDb([{ ...STORE, perPageTrackingEnabled: false }]);
    const config = await resolveTrackingConfig(db, { storeId: "s-1", landingPageId: "lp-1" });
    expect(config?.pixelId).toBe("111");
    expect(db.select).toHaveBeenCalledTimes(1);
  });
});

describe("resolvePublicTracking", () => {
  it("never exposes the token", async () => {
    const db = makeDb([STORE]);
    const pub = await resolvePublicTracking(db, { storeId: "s-1" });
    expect(pub.pixelId).toBe("111");
    expect(pub).not.toHaveProperty("accessToken");
  });
});
