/**
 * Route-level integration tests for the Images routers (Vercel Blob port).
 * Upload runs through the OpenAPIHono router; serve 301-redirects via plain
 * Hono. The S3 presign route is retired — direct browser uploads go through
 * POST /api/images/blob-callback (plain Hono, SDK-driven shapes, untestable
 * without the @vercel/blob client).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { Hono } from "hono";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import { uploadRouter, serveRouter } from "./routes";
import { blobPut, blobPublicUrl } from "@/lib/blob";

vi.mock("@/lib/blob", () => ({
  blobPut: vi.fn(),
  blobDel: vi.fn(),
  blobContentType: vi.fn(),
  blobPublicUrl: vi.fn(),
}));

function makeFile(name: string, type: string, size = 10) {
  return new File([new Uint8Array(size)], name, { type });
}

describe("Images routes", () => {
  let app: OpenAPIHono<AppContext>;

  beforeEach(() => {
    app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
    app.use("*", async (c, next) => {
      c.env = { DB: {} } as any;
      c.set("user", {
        id: "admin_user_001",
        email: "admin@example.com",
        name: "Admin User",
        role: "admin",
        status: "active",
        apiKey: "cod_admin_key",
      } as any);
      await next();
    });
    app.onError(errorHandler);
    app.route("/api/images", uploadRouter);
    app.route("/images", serveRouter as unknown as Hono<AppContext>);
    vi.clearAllMocks();
  });

  describe("POST /api/images/upload", () => {
    it("uploads a valid image and returns key + url with 201", async () => {
      vi.mocked(blobPut).mockResolvedValue({
        url: "https://blob.example.com/products/abc.jpg",
        pathname: "products/abc.jpg",
      });
      const form = new FormData();
      form.append("file", makeFile("product.jpg", "image/jpeg"));

      const res = await app.request("/api/images/upload", {
        method: "POST",
        body: form,
      });

      expect(res.status).toBe(201);
      const body: any = await res.json();
      expect(body.data.key).toBe("products/abc.jpg");
      expect(body.data.url).toBe("https://blob.example.com/products/abc.jpg");
      expect(blobPut).toHaveBeenCalledTimes(1);
    });

    it("returns 400 INVALID_FILE_TYPE for a disallowed file type", async () => {
      const form = new FormData();
      form.append("file", makeFile("doc.pdf", "application/pdf"));

      const res = await app.request("/api/images/upload", {
        method: "POST",
        body: form,
      });

      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body.code).toBe(ERROR_CODES.INVALID_FILE_TYPE);
    });

    it("returns 400 FILE_TOO_LARGE above 10 MB", async () => {
      const form = new FormData();
      form.append(
        "file",
        makeFile("big.png", "image/png", 11 * 1024 * 1024)
      );

      const res = await app.request("/api/images/upload", {
        method: "POST",
        body: form,
      });

      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body.code).toBe(ERROR_CODES.FILE_TOO_LARGE);
    });

    it("returns 500 when Blob storage fails", async () => {
      vi.mocked(blobPut).mockRejectedValue(new Error("blob down"));
      const form = new FormData();
      form.append("file", makeFile("product.jpg", "image/jpeg"));

      const res = await app.request("/api/images/upload", {
        method: "POST",
        body: form,
      });

      expect(res.status).toBe(500);
    });
  });

  describe("GET /images/{key} (public serving)", () => {
    it("301-redirects to the Blob CDN URL", async () => {
      vi.mocked(blobPublicUrl).mockResolvedValue("https://blob.example.com/products/abc.jpg");

      const res = await app.request("/images/products/abc.jpg");

      expect(res.status).toBe(301);
      expect(res.headers.get("Location")).toBe("https://blob.example.com/products/abc.jpg");
      expect(blobPublicUrl).toHaveBeenCalledWith("products/abc.jpg");
    });

    it("rejects path traversal keys with 400", async () => {
      const res = await app.request("/images/%2e%2e%2fsecret.txt");

      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body.category).toBe("VALIDATION");
    });

    it("returns 404 when the object does not exist", async () => {
      vi.mocked(blobPublicUrl).mockResolvedValue(null);

      const res = await app.request("/images/products/missing.jpg");

      expect(res.status).toBe(404);
      const body: any = await res.json();
      expect(body.code).toBe("IMAGE_NOT_FOUND");
    });
  });
});
