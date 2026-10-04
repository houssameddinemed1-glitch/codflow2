/**
 * Images Routes
 *
 * Two routers, two different worlds (both mounted in src/index.ts):
 *   - uploadRouter → /api/images/*   (auth + `products:manage` scope)
 *       POST /upload         — multipart upload straight to R2
 *       POST /presign         — R2 presigned PUT for direct browser uploads
 *                              (bypasses the function body cap)
 *
 *   - serveRouter   → /images/:key{.+}  (public, no auth)
 *       301 redirects to the MEDIA_DOMAIN custom domain, or streams bytes
 *       from R2 when unset. Deliberately kept on plain Hono:
 *       the route needs Hono's regex param (`:key{.+}`) so keys with slashes
 *       match, which cannot be expressed in a @hono/zod-openapi createRoute
 *       path. Its documentation is preserved as a legacy path entry in
 *       openapi.ts.
 *
 * Built with defineRoute() — the standard route-builder pattern.
 * MIME-type and size checks stay in the handlers to preserve their
 * specific error codes.
 */

import { OpenAPIHono, z } from "@hono/zod-openapi";
import { Hono } from "hono";
import type { AppContext } from "@/types";
import { defineRoute } from "@/lib/route-builder";
import { requireScope } from "@/rbac/middleware";
import { SCOPES } from "../../../../cod-shared/rbac/scopes";
import * as h from "./handlers";
import { presignUpload, presignRequestSchema } from "./presign";
import {
  UploadedImageSchema,
  SuccessResponseSchema,
} from "@/openapi/schemas";

const jsonContent = <T extends z.ZodType>(schema: T) => ({
  "application/json": { schema },
});

// ─── Routes ───────────────────────────────────────────────────────────────────

const uploadImageRoute = defineRoute({
  method: "post",
  path: "/upload",
  auth: { scope: SCOPES.PRODUCTS_MANAGE },
  tags: ["Images"],
  summary: "Upload image",
  description:
    "Upload an image file (jpg, png, webp, gif) to R2 storage. Max 10 MB. Content type must be multipart/form-data with a single `file` field.",
  operationId: "uploadImage",
  bodyContent: {
    "multipart/form-data": {
      schema: z.object({
        file: z.instanceof(File).openapi({ type: "string", format: "binary" }),
      }),
    },
  },
  responses: {
    201: {
      description: "Image uploaded successfully",
      content: jsonContent(SuccessResponseSchema(UploadedImageSchema)),
    },
    400: {
      description:
        "Validation error - missing file, invalid type, or file too large (VALIDATION_FAILED / REQUIRED_FIELD_MISSING / INVALID_FILE_TYPE / FILE_TOO_LARGE)",
    },
    500: { description: "System error - Blob storage failure (INTERNAL_SERVER_ERROR)" },
  },
  handler: h.uploadImage,
});

// ─── Routers ──────────────────────────────────────────────────────────────────

// Upload route — requires auth (goes through /api/* middleware)
export const uploadRouter = new OpenAPIHono<AppContext>();
uploadRouter.openapi(uploadImageRoute.route, uploadImageRoute.handler);

// Token endpoint for R2 direct browser uploads. Plain Hono (not an
// OpenAPI route): the browser PUTs bytes straight to R2 with the minted URL.
// Mounted in index.ts next to uploadRouter.
export const presignRouter = new Hono<AppContext>();
presignRouter.post("/presign", requireScope(SCOPES.PRODUCTS_MANAGE), (c) =>
  presignUpload(c),
);

// Serve route — no auth, mounted outside /api/*
// Plain Hono on purpose: `:key{.+}` regex param is required so that object
// keys containing slashes (e.g. "products/abc.jpg") keep matching. See the
// module docblock above.
const serveRouter = new Hono<AppContext>();
serveRouter.get("/:key{.+}", h.serveImage);

export { serveRouter };
