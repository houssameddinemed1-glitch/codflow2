/**
 * getStoreConfig turnstile projection — unit tests
 *
 * Pins the public-config contract: the storefront payload may carry the
 * site key (public by design) but NEVER the siteverify secret. No row or a
 * disabled row → feature inert (false + null).
 */

import { describe, it, expect, vi } from "vitest";
import { getStoreConfig } from "./store";

const STORE_ROW = {
  id: "store-1",
  name: "Test Store",
  domain: null,
  status: "active",
};

function makeDb(rows: unknown[]) {
  const queue = [...rows];
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          get: vi.fn(async () => queue.shift()),
        })),
      })),
    })),
  } as any;
  return db;
}

describe("getStoreConfig turnstile projection", () => {
  it("no turnstile row → turnstileEnabled=false, turnstileSiteKey=null (feature inert)", async () => {
    const db = makeDb([STORE_ROW, { pixelId: "px-1", enabled: false, conversionEvent: "Purchase" }, undefined, undefined, undefined]);

    const config = await getStoreConfig(db, "store-1");

    expect(config?.turnstileEnabled).toBe(false);
    expect(config?.turnstileSiteKey).toBeNull();
    expect(config?.otpEnabled).toBe(false);
  });

  it("enabled turnstile row → turnstileEnabled=true and the public siteKey is exposed", async () => {
    const db = makeDb([
      STORE_ROW,
      { pixelId: "px-1", enabled: true, conversionEvent: "Purchase" },
      undefined,
      { enabled: false },
      { enabled: true, siteKey: "0x4AAA-site" },
    ]);

    const config = await getStoreConfig(db, "store-1");

    expect(config?.turnstileEnabled).toBe(true);
    expect(config?.turnstileSiteKey).toBe("0x4AAA-site");
  });

  it("disabled turnstile row → turnstileEnabled=false and siteKey hidden", async () => {
    const db = makeDb([STORE_ROW, undefined, undefined, undefined, { enabled: false, siteKey: "0x4AAA-site" }]);

    const config = await getStoreConfig(db, "store-1");

    expect(config?.turnstileEnabled).toBe(false);
    expect(config?.turnstileSiteKey).toBeNull();
  });

  it("the projection never includes the secret key column", async () => {
    const db = makeDb([
      STORE_ROW,
      undefined,
      undefined,
      undefined,
      { enabled: true, siteKey: "0x4AAA-site", secretKey: "0x4AAA-secret" },
    ]);

    const config = await getStoreConfig(db, "store-1");

    expect(JSON.stringify(config)).not.toContain("0x4AAA-secret");
    expect(JSON.stringify(config)).not.toContain("secretKey");
    expect(JSON.stringify(config)).not.toContain("secret_key");
  });

  it("enabled tiktok row → tiktokPixelId exposed, token never leaks", async () => {
    const db = makeDb([
      STORE_ROW,
      undefined,
      { pixelId: "tt-1", enabled: true, conversionEvent: "Lead", accessToken: "tok-secret" },
      undefined,
      undefined,
    ]);

    const config = await getStoreConfig(db, "store-1");

    expect(config?.tiktokPixelId).toBe("tt-1");
    expect(config?.tiktokConversionEvent).toBe("Lead");
    expect(JSON.stringify(config)).not.toContain("tok-secret");
    expect(JSON.stringify(config)).not.toContain("accessToken");
    expect(JSON.stringify(config)).not.toContain("access_token");
  });

  it("disabled tiktok row → tiktokPixelId=null (feature inert, Meta untouched)", async () => {
    const db = makeDb([
      STORE_ROW,
      { pixelId: "px-1", enabled: true, conversionEvent: "Purchase" },
      { pixelId: "tt-1", enabled: false, conversionEvent: "Lead" },
      undefined,
      undefined,
    ]);

    const config = await getStoreConfig(db, "store-1");

    expect(config?.tiktokPixelId).toBeNull();
    expect(config?.pixelId).toBe("px-1");
  });

  it("no form row → formVariant defaults to 'default' (existing behavior)", async () => {
    const db = makeDb([
      STORE_ROW,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);

    const config = await getStoreConfig(db, "store-1");

    expect(config?.formVariant).toBe("default");
  });

  it("form row → formVariant exposed to the storefront", async () => {
    const db = makeDb([
      STORE_ROW,
      undefined,
      undefined,
      undefined,
      undefined,
      { variant: "form_a" },
    ]);

    const config = await getStoreConfig(db, "store-1");

    expect(config?.formVariant).toBe("form_a");
  });
});
