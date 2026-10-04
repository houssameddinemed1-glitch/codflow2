import type { Context } from "hono";
import type { AppContext } from "@/types";
import { z } from "zod";
import { presignPutUrl, publicUrlFor, type S3PresignConfig } from "@/lib/blob";
import { ValidationError } from "@/lib/errors/classes";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const PRESIGN_TTL_SECONDS = 600; // 10 minutes

const FOLDERS = new Set(["products", "landing"]);

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
  };
  return map[mime] ?? "jpg";
}

export const presignRequestSchema = z.object({
  contentType: z.string().min(1),
  folder: z.enum(["products", "landing"]).optional().default("products"),
});

/**
 * POST /api/images/presign
 * R2 direct browser upload: the dashboard POSTs a MIME type (+ optional
 * folder) and receives a ten-minute PUT URL for a server-minted key, then
 * PUTs the bytes straight to R2 (bypasses the Worker — required: Workers
 * cap request bodies well below 10 MB). The browser needs the R2 CORS rule
 * (scripts/setup-r2-cors.mjs, one-time).
 */
export async function presignUpload(c: Context<AppContext>) {
  const body: any = (c.req as any).valid?.("json") ?? (await c.req.json().catch(() => ({})));
  const parsed = presignRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      "contentType is required",
      ERROR_CODES.REQUIRED_FIELD_MISSING,
      { field: "contentType" },
    );
  }
  const { contentType, folder } = parsed.data;

  if (!ALLOWED_TYPES.has(contentType)) {
    throw new ValidationError(
      "Invalid file type. Allowed: jpg, png, webp, gif",
      ERROR_CODES.INVALID_FILE_TYPE,
      { fileType: contentType },
    );
  }
  if (!FOLDERS.has(folder)) {
    throw new ValidationError(
      "folder must be products or landing",
      ERROR_CODES.VALIDATION_FAILED,
      { folder },
    );
  }

  const accountId = c.env.CF_ACCOUNT_ID;
  const accessKeyId = c.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = c.env.R2_SECRET_ACCESS_KEY;
  const bucketName = c.env.R2_BUCKET_NAME;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    throw new ValidationError(
      "Direct upload is not configured",
      ERROR_CODES.INTERNAL_SERVER_ERROR,
    );
  }
  const cfg: S3PresignConfig = { accountId, accessKeyId, secretAccessKey, bucketName };

  const key = `${folder}/${crypto.randomUUID().replace(/-/g, "")}.${extFromMime(contentType)}`;
  let presignedUrl: string;
  try {
    presignedUrl = await presignPutUrl(cfg, key, contentType, PRESIGN_TTL_SECONDS);
  } catch (error) {
    throw new ValidationError(
      "Failed to mint upload URL",
      ERROR_CODES.INTERNAL_SERVER_ERROR,
      { error: error instanceof Error ? error.message : String(error) },
    );
  }

  return c.json(
    {
      success: true,
      data: {
        presignedUrl,
        key,
        publicUrl: publicUrlFor(key, {
          mediaDomain: c.env.MEDIA_DOMAIN ?? null,
          workerUrl: c.env.WORKER_URL ?? null,
        }),
        maxSizeBytes: MAX_SIZE_BYTES,
      },
    },
    201,
  );
}
