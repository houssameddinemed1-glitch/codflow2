/**
 * COD Flow API — Hono application.
 *
 * This file defines the Hono app and mounts all routes/middleware.
 * It is consumed by two entry points:
 *   - Cloudflare Workers (wrangler main) — `export default app` below
 *     receives the real bindings (D1, KV, R2) as c.env.
 *   - api/index.ts (Vercel) — imports the app and wraps it for Vercel's
 *     runtime with an Env shim built from process.env.
 */

import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppContext, Env } from "@/types";
import { getDb } from "@/db";
import { configureBlobStorage } from "@/lib/blob";
import { corsMiddleware } from "@/middleware/cors";
import { authMiddleware } from "@/middleware/auth";
import { storeAuthMiddleware } from "@/middleware/storeAuth";
import { errorHandler } from "@/middleware/error";

// Import routes
import storeRoutes from "@/endpoints/store/routes";
import webhooksRouter from "@/endpoints/webhooks/routes";
import ordersRoutes from "@/endpoints/orders/routes";
import usersRoutes from "@/endpoints/users/routes";
import customersRoutes from "@/endpoints/customers/routes";
import customerGroupsRoutes from "@/endpoints/customer-groups/routes";
import customerTagsRoutes from "@/endpoints/customer-tags/routes";
import driversRoutes from "@/endpoints/drivers/routes";
import wilayasRoutes from "@/endpoints/wilayas/routes";
import deliveryCompaniesRoutes from "@/endpoints/delivery-companies/routes";
import productsRoutes from "@/endpoints/products/routes";
import productGroupsRoutes from "@/endpoints/product-groups/routes";
import landingPagesRoutes from "@/endpoints/landing-pages/routes";
import shippingProfilesRoutes from "@/endpoints/shipping-profiles/routes";
import driverPaymentsRoutes from "@/endpoints/driver-payments/routes";
import { uploadRouter, serveRouter, presignRouter } from "@/endpoints/images/routes";
import activityLogsRoutes from "@/endpoints/activity-logs/routes";
import storesRoutes from "@/endpoints/stores/routes";
import reviewsRoutes from "@/endpoints/reviews/routes";
import offersRoutes from "@/endpoints/offers/routes";
import { stockRouter, productStockRouter } from "@/endpoints/stock/routes";
import { registerSpecEndpoint } from "@/openapi/serve";
import { openApiValidationHook } from "@/openapi/validation-hook";
import analyticsRoutes from "@/endpoints/analytics/routes";
import abandonedOrdersRoutes from "@/endpoints/abandoned-orders/routes";
import storeAbandonedRoutes from "@/endpoints/abandoned-orders/store-routes";
import storeOtpRoutes from "@/endpoints/store-otp/store-routes";
import checkoutFormRoutes from "@/endpoints/checkout-form/routes";
import whatsappWidgetRoutes from "@/endpoints/whatsapp-widget/routes";
import storePagesRoutes from "@/endpoints/store-pages/routes";
import { internalWorkflowsRouter } from "@/workflows/routes";

// OpenAPIHono extends Hono: existing routes/middleware keep working, and
// routes registered via app.openapi() validate requests and feed the
// generated spec. The default hook keeps framework validation errors in
// the platform error envelope.
const app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });

// Global middleware
app.use("*", corsMiddleware);
// Cloudflare Workers have no process.env per request — a few shared modules
// (queue, lp runner) still read deployment-constant values from it. Mirror
// them from the bindings once per request; values are identical for every
// request of this deployment, so this is isolate-safe.
app.use("*", async (c, next) => {
  const mirror = (key: "QSTASH_TOKEN" | "QSTASH_CURRENT_SIGNING_KEY" | "QSTASH_NEXT_SIGNING_KEY" | "WORKER_SELF_URL" | "MEDIA_DOMAIN") => {
    const value = c.env[key];
    if (value) process.env[key] = value;
  };
  mirror("QSTASH_TOKEN");
  mirror("QSTASH_CURRENT_SIGNING_KEY");
  mirror("QSTASH_NEXT_SIGNING_KEY");
  mirror("WORKER_SELF_URL");
  mirror("MEDIA_DOMAIN");
  await next();
});
// Default R2 storage for the 3-arg blob seam (same bucket every request).
app.use("*", async (c, next) => {
  if (c.env.IMAGES) {
    configureBlobStorage({
      bucket: c.env.IMAGES,
      mediaDomain: c.env.MEDIA_DOMAIN ?? null,
      workerUrl: c.env.WORKER_URL ?? null,
    });
  }
  await next();
});
app.onError(errorHandler);

// Image serving — no auth required (public, cacheable)
app.route("/images", serveRouter);

// OpenAPI documentation — no auth required (public)
// Must be mounted BEFORE app.use("/api/*", authMiddleware)
registerSpecEndpoint(app);

// Webhook receivers — public, no auth, signature-verified internally
// MUST be mounted BEFORE app.use("/api/*", authMiddleware)
app.route("/webhooks", webhooksRouter);

// Store API — separate auth (must be before /api/* authMiddleware)
app.use("/store/*", storeAuthMiddleware);
app.route("/store", storeRoutes);
app.route("/store", storeAbandonedRoutes);
app.route("/store", storeOtpRoutes);

// Health check (no auth required)
app.get("/", (c) => {
  return c.json({
    service: "COD Flow API",
    version: "1.0.0",
    status: "healthy",
    environment: c.env.ENVIRONMENT,
  });
});

app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

// ─── Internal workflows (QStash-verified) ────────────────────────────────────
// POST /api/internal/workflows/capi — receives QStash callbacks
// POST /api/internal/workflows/tiktok — receives QStash callbacks
// POST /api/internal/workflows/lp-image-upload — receives QStash callbacks
// NOTE: the /api prefix must match lib/queue.ts publishWorkflow, and this
// mount must stay BEFORE app.use("/api/*", authMiddleware) — QStash carries
// no merchant JWT (signature verified per request inside the router).
app.route("/api/internal/workflows", internalWorkflowsRouter);

// ─── Cron (Vercel Cron / QStash scheduled) ───────────────────────────────────
// GET /api/cron — sweep abandoned orders + sync NOEST order statuses
// (protected by CRON_SECRET header)
app.get("/api/cron", async (c) => {
  const secret = c.req.header("authorization")?.replace("Bearer ", "") ?? "";
  const expected = c.env.CRON_SECRET;
  if (expected && secret !== expected) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const { sweepAbandonedOrders } = await import("@/cron/sweep-abandoned-orders");
  const count = await sweepAbandonedOrders(getDb(c.env.DB));

  // NOEST has no status webhooks — this daily run is the automatic freshness
  // source for NOEST parcels. Failures must never break the sweep response.
  let noest: unknown = { ran: false, reason: "skipped" };
  try {
    const { getDb } = await import("@/db");
    const { reconcileAllNoestCompanies } = await import(
      "@/endpoints/delivery-companies/providers/noest/reconcile"
    );
    noest = await reconcileAllNoestCompanies(getDb(c.env.DB));
  } catch (err) {
    console.error("[cron] noest reconcile failed:", err instanceof Error ? err.message : err);
    noest = { ran: false, reason: "error" };
  }
  return c.json({ ok: true, swept: count, noest });
});

// Protected routes (require authentication)
app.use("/api/*", authMiddleware);

// Mount endpoint routes
app.route("/api/images", uploadRouter);
app.route("/api/images", presignRouter);
app.route("/api/activity-logs", activityLogsRoutes);
app.route("/api/orders", ordersRoutes);
app.route("/api/users", usersRoutes);
app.route("/api/customers", customersRoutes);
app.route("/api/customer-groups", customerGroupsRoutes);
app.route("/api/customer-tags", customerTagsRoutes);
app.route("/api/drivers", driversRoutes);
app.route("/api/wilayas", wilayasRoutes);
app.route("/api/delivery-companies", deliveryCompaniesRoutes);
app.route("/api/products", productsRoutes);
app.route("/api/product-groups", productGroupsRoutes);
app.route("/api/landing-pages", landingPagesRoutes);
app.route("/api/shipping-profiles", shippingProfilesRoutes);
app.route("/api/driver-payments", driverPaymentsRoutes);
app.route("/api/stores", storesRoutes);
app.route("/api/reviews", reviewsRoutes);
app.route("/api/offers", offersRoutes);
app.route("/api/stock", stockRouter);
app.route("/api/products", productStockRouter);
app.route("/api/analytics", analyticsRoutes);
app.route("/api/abandoned-orders", abandonedOrdersRoutes);
app.route("/api/checkout-form", checkoutFormRoutes);
app.route("/api/whatsapp-widget", whatsappWidgetRoutes);
app.route("/api/store-pages", storePagesRoutes);

// 404 handler
app.notFound((c) => {
  return c.json({ error: "Not found" }, 404);
});

// Export for Vercel entry point — does NOT export CF-specific stuff
export default app;
