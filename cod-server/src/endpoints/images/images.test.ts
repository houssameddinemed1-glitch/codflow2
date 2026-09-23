/**
 * Integration Tests for Images Endpoint (Vercel Blob port)
 *
 * Tests error scenarios for images endpoints. Storage goes through the
 * `@/lib/blob` seam (mocked here); the S3 presign route is retired —
 * direct browser uploads use POST /api/images/blob-callback instead.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { ERROR_CODES, ERROR_CATEGORIES } from "../../../../cod-shared/errors/codes";
import * as handlers from "./handlers";
import { blobPut, blobDel, blobPublicUrl } from "@/lib/blob";

vi.mock("@/lib/blob", () => ({
  blobPut: vi.fn(),
  blobDel: vi.fn(),
  blobContentType: vi.fn(),
  blobPublicUrl: vi.fn(),
}));

// Rows resolved by bare-awaited drizzle builders (pg-convention thenable).
let dbRows: any[] = [];

// Mock the database
const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  then: (resolve: (rows: any[]) => unknown) => Promise.resolve(dbRows).then(resolve),
  all: vi.fn(),
  get: vi.fn(),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn(),
  delete: vi.fn().mockReturnThis(),
} as any;

vi.mock("@/db", () => ({
  getDb: vi.fn(() => mockDb),
}));

describe("Images Endpoint - Error Scenarios", () => {
  let app: Hono<AppContext>;

  beforeEach(() => {
    app = new Hono<AppContext>();

    // Add middleware to inject mock env and user
    app.use("*", async (c, next) => {
      c.env = {
        DB: mockDb,
      } as any;
      c.set("user", { id: "user-123", email: "test@example.com" } as any);
      await next();
    });

    app.onError(errorHandler);
    app.post("/api/images/upload", handlers.uploadImage);
    app.get("/images/:key{.+}", handlers.serveImage);
    app.get("/api/products/:id/images", handlers.listProductImages);
    app.post("/api/products/:id/images", handlers.saveProductImage);
    app.delete("/api/products/:id/images/:imageId", handlers.deleteProductImage);

    vi.clearAllMocks();
    dbRows = [];
  });

  describe("POST /api/images/upload", () => {
    it("should return 400 with REQUIRED_FIELD_MISSING code when file is missing", async () => {
      const formData = new FormData();
      // No file added

      const res = await app.request("/api/images/upload", {
        method: "POST",
        body: formData,
      });

      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body).toMatchObject({
        error: "Missing file field",
        code: ERROR_CODES.REQUIRED_FIELD_MISSING,
        category: ERROR_CATEGORIES.VALIDATION,
        context: {
          field: "file",
        },
      });
    });

    it("should return 400 with INVALID_FILE_TYPE code when file type is not allowed", async () => {
      const formData = new FormData();
      const file = new File(["test"], "test.pdf", { type: "application/pdf" });
      formData.append("file", file);

      const res = await app.request("/api/images/upload", {
        method: "POST",
        body: formData,
      });

      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body).toMatchObject({
        error: "Invalid file type. Allowed: jpg, png, webp, gif",
        code: ERROR_CODES.INVALID_FILE_TYPE,
        category: ERROR_CATEGORIES.VALIDATION,
      });
      expect(body.context).toHaveProperty("fileType", "application/pdf");
      expect(body.context).toHaveProperty("allowedTypes");
      expect(Array.isArray(body.context.allowedTypes)).toBe(true);
    });

    it("should return 400 with FILE_TOO_LARGE code when file exceeds max size", async () => {
      const formData = new FormData();
      // Create a file larger than 10 MB
      const largeContent = new Uint8Array(11 * 1024 * 1024); // 11 MB
      const file = new File([largeContent], "large-image.jpg", { type: "image/jpeg" });
      formData.append("file", file);

      const res = await app.request("/api/images/upload", {
        method: "POST",
        body: formData,
      });

      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body).toMatchObject({
        error: "File too large. Max 10 MB",
        code: ERROR_CODES.FILE_TOO_LARGE,
        category: ERROR_CATEGORIES.VALIDATION,
      });
      expect(body.context).toHaveProperty("fileSize");
      expect(body.context).toHaveProperty("maxSize", 10 * 1024 * 1024);
      expect(body.context).toHaveProperty("fileName", "large-image.jpg");
    });

    it("should return 500 with INTERNAL_SERVER_ERROR code when Blob upload fails", async () => {
      const formData = new FormData();
      const file = new File(["test"], "test.jpg", { type: "image/jpeg" });
      formData.append("file", file);

      // Mock Blob put to throw an error
      vi.mocked(blobPut).mockRejectedValue(new Error("Blob connection failed"));

      const res = await app.request("/api/images/upload", {
        method: "POST",
        body: formData,
      });

      expect(res.status).toBe(500);
      const body: any = await res.json();
      expect(body).toMatchObject({
        error: "Failed to upload image to storage",
        code: ERROR_CODES.INTERNAL_SERVER_ERROR,
        category: ERROR_CATEGORIES.SYSTEM,
      });
      expect(body.context).toHaveProperty("key");
      expect(body.context).toHaveProperty("fileName", "test.jpg");
    });

    it("should return 201 when image is uploaded successfully", async () => {
      const formData = new FormData();
      const file = new File(["test"], "test.jpg", { type: "image/jpeg" });
      formData.append("file", file);

      vi.mocked(blobPut).mockResolvedValue({
        url: "https://blob.example.com/products/abc123.jpg",
        pathname: "products/abc123.jpg",
      });

      const res = await app.request("/api/images/upload", {
        method: "POST",
        body: formData,
      });

      expect(res.status).toBe(201);
      const body: any = await res.json();
      expect(body).toMatchObject({
        success: true,
        data: expect.objectContaining({
          key: expect.stringMatching(/^products\/[a-f0-9]+\.jpg$/),
          url: "https://blob.example.com/products/abc123.jpg",
        }),
      });
    });
  });

  describe("GET /images/:key", () => {
    it("should return 404 when the route does not match (missing key)", async () => {
      const res = await app.request("/images/", {
        method: "GET",
      });

      // This will likely 404 due to route not matching, but let's test the handler directly
      // In practice, the route pattern ensures key is present
      expect(res.status).toBe(404);
    });

    it("should return 400 with VALIDATION_FAILED code when key contains path traversal", async () => {
      // Test with a key that starts with / (absolute path)
      const res = await app.request("/images//etc/passwd", {
        method: "GET",
      });

      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body).toMatchObject({
        error: "Invalid key",
        code: ERROR_CODES.VALIDATION_FAILED,
        category: ERROR_CATEGORIES.VALIDATION,
      });
      expect(body.context).toHaveProperty("key");
    });

    it("should return 404 with IMAGE_NOT_FOUND code when image does not exist in Blob", async () => {
      vi.mocked(blobPublicUrl).mockResolvedValue(null);

      const res = await app.request("/images/products/nonexistent.jpg", {
        method: "GET",
      });

      expect(res.status).toBe(404);
      const body: any = await res.json();
      expect(body).toMatchObject({
        error: "Image with ID products/nonexistent.jpg not found",
        code: ERROR_CODES.IMAGE_NOT_FOUND,
        category: ERROR_CATEGORIES.BUSINESS_LOGIC,
        context: {
          entity: "Image",
          id: "products/nonexistent.jpg",
        },
      });
    });

    it("should 301-redirect to the Blob CDN URL when image exists", async () => {
      vi.mocked(blobPublicUrl).mockResolvedValue("https://blob.example.com/products/test.jpg");

      const res = await app.request("/images/products/test.jpg", {
        method: "GET",
      });

      expect(res.status).toBe(301);
      expect(res.headers.get("Location")).toBe("https://blob.example.com/products/test.jpg");
    });
  });

  describe("POST /api/products/:id/images", () => {
    it("should return 400 with REQUIRED_FIELD_MISSING code when key or src is missing", async () => {
      const res = await app.request("/api/products/prod_123/images", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          // Missing key and src
        }),
      });

      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body).toMatchObject({
        error: "key and src are required",
        code: ERROR_CODES.REQUIRED_FIELD_MISSING,
        category: ERROR_CATEGORIES.VALIDATION,
      });
      expect(body.context).toHaveProperty("missingFields");
      expect(Array.isArray(body.context.missingFields)).toBe(true);
    });

    it("should return 201 when image record is saved successfully", async () => {
      dbRows = [];
      mockDb.insert.mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      });

      const res = await app.request("/api/products/prod_123/images", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          key: "products/abc123.jpg",
          src: "https://example.com/images/products/abc123.jpg",
          altText: "Product image",
        }),
      });

      expect(res.status).toBe(201);
      const body: any = await res.json();
      expect(body).toMatchObject({
        success: true,
        data: expect.objectContaining({
          productId: "prod_123",
          src: "https://example.com/images/products/abc123.jpg",
          r2Key: "products/abc123.jpg",
          altText: "Product image",
        }),
      });
    });
  });

  describe("DELETE /api/products/:id/images/:imageId", () => {
    it("should return 404 with IMAGE_NOT_FOUND code when image does not exist", async () => {
      dbRows = [];

      const res = await app.request("/api/products/prod_123/images/img_nonexistent", {
        method: "DELETE",
      });

      expect(res.status).toBe(404);
      const body: any = await res.json();
      expect(body).toMatchObject({
        error: "Image with ID img_nonexistent not found",
        code: ERROR_CODES.IMAGE_NOT_FOUND,
        category: ERROR_CATEGORIES.BUSINESS_LOGIC,
        context: {
          entity: "Image",
          id: "img_nonexistent",
        },
      });
    });

    it("should return 500 with INTERNAL_SERVER_ERROR code when Blob delete fails", async () => {
      dbRows = [
        {
          id: "img_123",
          productId: "prod_123",
          r2Key: "products/abc123.jpg",
          src: "https://example.com/images/products/abc123.jpg",
        },
      ];
      vi.mocked(blobDel).mockRejectedValue(new Error("Blob delete failed"));

      const res = await app.request("/api/products/prod_123/images/img_123", {
        method: "DELETE",
      });

      expect(res.status).toBe(500);
      const body: any = await res.json();
      expect(body).toMatchObject({
        error: "Failed to delete image from storage",
        code: ERROR_CODES.INTERNAL_SERVER_ERROR,
        category: ERROR_CATEGORIES.SYSTEM,
      });
      expect(body.context).toHaveProperty("imageId", "img_123");
      expect(body.context).toHaveProperty("r2Key", "products/abc123.jpg");
    });

    it("should return 200 when image is deleted successfully", async () => {
      dbRows = [
        {
          id: "img_123",
          productId: "prod_123",
          r2Key: "products/abc123.jpg",
          src: "https://example.com/images/products/abc123.jpg",
        },
      ];
      vi.mocked(blobDel).mockResolvedValue(undefined);
      mockDb.delete.mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });

      const res = await app.request("/api/products/prod_123/images/img_123", {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body).toMatchObject({
        success: true,
      });
    });
  });

  describe("Error Response Structure", () => {
    it("should always include error, code, and category fields in error responses", async () => {
      const formData = new FormData();
      // No file added

      const res = await app.request("/api/images/upload", {
        method: "POST",
        body: formData,
      });

      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body).toHaveProperty("error");
      expect(body).toHaveProperty("code");
      expect(body).toHaveProperty("category");
      expect(typeof body.error).toBe("string");
      expect(typeof body.code).toBe("string");
      expect(typeof body.category).toBe("string");
    });

    it("should include context field when available", async () => {
      const formData = new FormData();
      const file = new File(["test"], "test.pdf", { type: "application/pdf" });
      formData.append("file", file);

      const res = await app.request("/api/images/upload", {
        method: "POST",
        body: formData,
      });

      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body).toHaveProperty("context");
      expect(body.context).toHaveProperty("fileType");
      expect(body.context).toHaveProperty("allowedTypes");
    });
  });
});
