/**
 * Route-level integration tests for Stores OpenAPIHono router.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { ERROR_CATEGORIES } from "../../../../cod-shared/errors/codes";
import storesRouter from "./routes";
import * as queries from "./queries";
import * as pixelConfigQueries from "../../../../cod-shared/queries/pixel-config";
import * as tiktokConfigQueries from "../../../../cod-shared/queries/tiktok-config";
import * as formConfigQueries from "../../../../cod-shared/queries/form-config";

const mockDb = {
  select: vi.fn(),
} as any;

vi.mock("@/db", () => ({
  getDb: vi.fn(() => mockDb),
}));
vi.mock("./queries");
vi.mock("../../../../cod-shared/queries/pixel-config");
vi.mock("../../../../cod-shared/queries/tiktok-config");
vi.mock("../../../../cod-shared/queries/form-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../cod-shared/queries/form-config")>();
  return { ...actual, getFormConfig: vi.fn(), upsertFormConfig: vi.fn() };
});

const NOW = new Date().toISOString();

function storeRow(overrides: Record<string, any> = {}) {
  return {
    id: "store_1",
    name: "My Shop",
    domain: null,
    logoUrl: "https://cdn.example.com/logo.png",
    themeId: "theme01",
    primaryColor: "#3b82f6",
    accentColor: "#f97316",
    bgColor: "#ffffff",
    fontFamily: "Cairo",
    fontUrl: "https://fonts.googleapis.com/css2?family=Cairo",
    lang: "ar" as const,
    currency: "DZD",
    currencySymbol: "دج",
    contentJson: null,
    metaTitle: "My Shop — Best Products",
    metaDescription: "Find the best products at My Shop.",
    ogImage: "https://cdn.example.com/og.png",
    announcementBar: "Free delivery on orders above 3000 دج",
    reviewsEnabled: true,
    status: "active" as const,
    storeApiKey: "sk_store_abc123",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function pixelConfigRow(overrides: Record<string, any> = {}) {
  return {
    id: "pix_1",
    storeId: "store_1",
    pixelId: "1234567890123456",
    adAccountName: "Main Ad Account",
    accessToken: "EAAG...",
    testEventCode: null,
    conversionEvent: "Purchase" as const,
    testMode: false,
    enabled: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function tiktokConfigRow(overrides: Record<string, any> = {}) {
  return {
    id: "tt_1",
    storeId: "store_1",
    pixelId: "D0ABC1234567890DEF123",
    adAccountName: "TikTok Main",
    accessToken: "tt-access-token",
    testEventCode: null,
    conversionEvent: "Purchase" as const,
    testMode: false,
    enabled: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("Stores routes (OpenAPIHono)", () => {
  let app: OpenAPIHono<AppContext>;

  beforeEach(() => {
    app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
    app.use("*", async (c, next) => {
      c.env = { DB: mockDb } as any;
      c.set("user", {
        id: "admin_user_001",
        email: "admin@example.com",
        name: "Admin User",
        role: "admin",
        status: "active",
        apiKey: null,
        createdAt: NOW,
        updatedAt: NOW,
      } as any);
      await next();
    });
    app.onError(errorHandler);
    app.route("/api/stores", storesRouter);
    vi.clearAllMocks();
  });

  describe("GET /api/stores/me", () => {
    it("returns 200 with store configuration", async () => {
      vi.mocked(queries.getStore).mockResolvedValue(storeRow());

      const res = await app.request("/api/stores/me");

      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.name).toBe("My Shop");
      expect(body.data.themeId).toBe("theme01");
    });

    it("returns 404 when no store exists", async () => {
      vi.mocked(queries.getStore).mockResolvedValue(undefined);

      const res = await app.request("/api/stores/me");

      expect(res.status).toBe(404);
      const body: any = await res.json();
      expect(body).toMatchObject({
        code: "STORE_NOT_FOUND",
        category: ERROR_CATEGORIES.BUSINESS_LOGIC,
      });
    });
  });

  describe("PATCH /api/stores/me", () => {
    it("updates store configuration successfully", async () => {
      vi.mocked(queries.getStore).mockResolvedValue(storeRow());
      vi.mocked(queries.updateStore).mockResolvedValue(
        storeRow({ name: "Updated Shop" })
      );

      const res = await app.request("/api/stores/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Updated Shop" }),
      });

      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.data.name).toBe("Updated Shop");
    });

    it("returns 400 for invalid hex color", async () => {
      vi.mocked(queries.getStore).mockResolvedValue(storeRow());

      const res = await app.request("/api/stores/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primaryColor: "not-a-color" }),
      });

      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body).toMatchObject({
        category: ERROR_CATEGORIES.VALIDATION,
      });
    });

    it("returns 404 when no store exists", async () => {
      vi.mocked(queries.getStore).mockResolvedValue(undefined);

      const res = await app.request("/api/stores/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Whatever" }),
      });

      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/stores/pixel-config", () => {
    it("returns 200 with the pixel configuration — token masked, never returned", async () => {
      vi.mocked(queries.getStore).mockResolvedValue(storeRow());
      vi.mocked(pixelConfigQueries.getPixelConfig).mockResolvedValue(pixelConfigRow());

      const res = await app.request("/api/stores/pixel-config");

      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.data.pixelId).toBe("1234567890123456");
      expect(body.data.enabled).toBe(true);
      expect(body.data.conversionEvent).toBe("Purchase");
      expect(body.data.accessTokenMasked).toBe("••••G...");
      expect(JSON.stringify(body)).not.toContain("EAAG");
    });

    it("returns 200 with null data when not configured", async () => {
      vi.mocked(queries.getStore).mockResolvedValue(storeRow());
      vi.mocked(pixelConfigQueries.getPixelConfig).mockResolvedValue(undefined);

      const res = await app.request("/api/stores/pixel-config");

      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.data).toBeNull();
    });

    it("returns 404 when no store exists", async () => {
      vi.mocked(queries.getStore).mockResolvedValue(undefined);

      const res = await app.request("/api/stores/pixel-config");

      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/stores/pixel-config", () => {
    it("saves pixel configuration successfully", async () => {
      vi.mocked(queries.getStore).mockResolvedValue(storeRow());
      vi.mocked(pixelConfigQueries.upsertPixelConfig).mockResolvedValue(pixelConfigRow());

      const res = await app.request("/api/stores/pixel-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pixelId: "1234567890123456", conversionEvent: "Purchase" }),
      });

      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.data.pixelId).toBe("1234567890123456");
      expect(body.data.accessTokenMasked).toBe("••••G...");
      expect(JSON.stringify(body)).not.toContain("EAAG");
    });

    it("accepts Lead as the conversion event and passes the new fields through", async () => {
      vi.mocked(queries.getStore).mockResolvedValue(storeRow());
      vi.mocked(pixelConfigQueries.upsertPixelConfig).mockResolvedValue(
        pixelConfigRow({ conversionEvent: "Lead", testMode: true, adAccountName: "Somer Ads" })
      );

      const res = await app.request("/api/stores/pixel-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pixelId: "1234567890123456",
          adAccountName: "Somer Ads",
          conversionEvent: "Lead",
          testMode: true,
          testEventCode: "TEST123",
        }),
      });

      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.data.conversionEvent).toBe("Lead");
      expect(body.data.testMode).toBe(true);
      expect(pixelConfigQueries.upsertPixelConfig).toHaveBeenCalledWith(
        mockDb,
        "store_1",
        expect.objectContaining({
          pixelId: "1234567890123456",
          adAccountName: "Somer Ads",
          conversionEvent: "Lead",
          testMode: true,
          testEventCode: "TEST123",
        })
      );
    });

    it("returns 400 when conversionEvent is missing — the merchant must choose explicitly", async () => {
      vi.mocked(queries.getStore).mockResolvedValue(storeRow());

      const res = await app.request("/api/stores/pixel-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pixelId: "1234567890123456" }),
      });

      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body).toMatchObject({ category: ERROR_CATEGORIES.VALIDATION });
    });

    it("returns 400 when conversionEvent is not Lead or Purchase", async () => {
      vi.mocked(queries.getStore).mockResolvedValue(storeRow());

      const res = await app.request("/api/stores/pixel-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pixelId: "1234567890123456", conversionEvent: "AddToCart" }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 when pixelId is missing", async () => {
      vi.mocked(queries.getStore).mockResolvedValue(storeRow());

      const res = await app.request("/api/stores/pixel-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body).toMatchObject({
        category: ERROR_CATEGORIES.VALIDATION,
      });
    });

    it("returns 404 when no store exists", async () => {
      vi.mocked(queries.getStore).mockResolvedValue(undefined);

      const res = await app.request("/api/stores/pixel-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pixelId: "123", conversionEvent: "Purchase" }),
      });

      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/stores/tiktok-config", () => {
    it("returns 200 with the TikTok configuration — token masked, never returned", async () => {
      vi.mocked(queries.getStore).mockResolvedValue(storeRow());
      vi.mocked(tiktokConfigQueries.getTiktokConfig).mockResolvedValue(tiktokConfigRow());

      const res = await app.request("/api/stores/tiktok-config");

      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.data.pixelId).toBe("D0ABC1234567890DEF123");
      expect(body.data.enabled).toBe(true);
      expect(body.data.conversionEvent).toBe("Purchase");
      expect(body.data.accessTokenMasked).toBe("••••oken");
      expect(JSON.stringify(body)).not.toContain("tt-access-token");
    });

    it("returns 200 with null data when not configured", async () => {
      vi.mocked(queries.getStore).mockResolvedValue(storeRow());
      vi.mocked(tiktokConfigQueries.getTiktokConfig).mockResolvedValue(undefined);

      const res = await app.request("/api/stores/tiktok-config");

      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.data).toBeNull();
    });

    it("returns 404 when no store exists", async () => {
      vi.mocked(queries.getStore).mockResolvedValue(undefined);

      const res = await app.request("/api/stores/tiktok-config");

      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/stores/tiktok-config", () => {    it("saves TikTok configuration successfully, independent from Meta", async () => {
      vi.mocked(queries.getStore).mockResolvedValue(storeRow());
      vi.mocked(tiktokConfigQueries.upsertTiktokConfig).mockResolvedValue(tiktokConfigRow());

      const res = await app.request("/api/stores/tiktok-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pixelId: "D0ABC1234567890DEF123", conversionEvent: "Lead" }),
      });

      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.data.pixelId).toBe("D0ABC1234567890DEF123");
      expect(JSON.stringify(body)).not.toContain("tt-access-token");
      expect(tiktokConfigQueries.upsertTiktokConfig).toHaveBeenCalledWith(
        mockDb,
        "store_1",
        expect.objectContaining({
          pixelId: "D0ABC1234567890DEF123",
          conversionEvent: "Lead",
        })
      );
      expect(pixelConfigQueries.upsertPixelConfig).not.toHaveBeenCalled();
    });

    it("returns 400 when conversionEvent is missing — the merchant must choose explicitly", async () => {
      vi.mocked(queries.getStore).mockResolvedValue(storeRow());

      const res = await app.request("/api/stores/tiktok-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pixelId: "D0ABC1234567890DEF123" }),
      });

      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body).toMatchObject({ category: ERROR_CATEGORIES.VALIDATION });
    });

    it("returns 400 when pixelId is missing", async () => {
      vi.mocked(queries.getStore).mockResolvedValue(storeRow());

      const res = await app.request("/api/stores/tiktok-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/stores/form-config", () => {
    it("returns 200 with null data when not configured (Default form)", async () => {
      vi.mocked(queries.getStore).mockResolvedValue(storeRow());
      vi.mocked(formConfigQueries.getFormConfig).mockResolvedValue(undefined);

      const res = await app.request("/api/stores/form-config");

      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.data).toBeNull();
    });

    it("returns the stored variant", async () => {
      vi.mocked(queries.getStore).mockResolvedValue(storeRow());
      vi.mocked(formConfigQueries.getFormConfig).mockResolvedValue({
        id: "form_1",
        storeId: "store_1",
        variant: "form_a",
        createdAt: NOW,
        updatedAt: NOW,
      });

      const res = await app.request("/api/stores/form-config");

      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.data.variant).toBe("form_a");
    });

    it("returns 404 when no store exists", async () => {
      vi.mocked(queries.getStore).mockResolvedValue(undefined);

      const res = await app.request("/api/stores/form-config");

      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/stores/form-config", () => {
    it("saves a known variant", async () => {
      vi.mocked(queries.getStore).mockResolvedValue(storeRow());
      vi.mocked(formConfigQueries.upsertFormConfig).mockResolvedValue({
        id: "form_1",
        storeId: "store_1",
        variant: "form_a",
        createdAt: NOW,
        updatedAt: NOW,
      });

      const res = await app.request("/api/stores/form-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variant: "form_a" }),
      });

      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.data.variant).toBe("form_a");
      expect(formConfigQueries.upsertFormConfig).toHaveBeenCalledWith(
        mockDb,
        "store_1",
        { variant: "form_a" }
      );
    });

    it("rejects an unknown variant key", async () => {
      vi.mocked(queries.getStore).mockResolvedValue(storeRow());

      const res = await app.request("/api/stores/form-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variant: "form_z" }),
      });

      expect(res.status).toBe(400);
    });
  });
});
