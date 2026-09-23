import { z } from "zod";
import { getDb } from "@/db";
import { parseImageDimensions, sniffImageType } from "@/lib/image-dimensions";
import { blobPut, blobPublicUrl } from "@/lib/blob";
import {
  canonicalImageContentType,
  IMAGE_CONTENT_TYPES,
  LANDING_IMAGE_R2_KEY_PATTERN,
  MAX_IMAGE_BYTES,
} from "@/lib/landing-image-upload";
import {
  addLandingPageImage,
  getLandingPageById,
  getLandingPageImages,
  markLpImageUploadComplete,
  markLpImageUploadFailed,
} from "../../../cod-shared/queries/landing-pages";
import { ACTIONS, logActivity } from "@/lib/activity";

/**
 * QStash runner for landing-page AI image uploads (replaces the Cloudflare
 * Workflow of the same name — same validation, same idempotency, same audit).
 *
 * Contract (mirrors run-capi/run-tiktok): terminal states record the job as
 * failed and return 200 (no QStash retry); only transport/storage/DB failures
 * throw (retry-worthy, QStash retries 5x).
 *
 * Vercel notes: no IMAGE_TRANSFORM binding exists here, so uploads are stored
 * in their source format (the old fail-open fallback); `converted` is true
 * only when the source already was WebP.
 */

/** Terminal failure — recorded on the job row, never retried. */
class NonRetryableError extends Error {}

const actorSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.enum(["admin", "staff"]),
});

const baseShape = {
  uploadJobId: z.string().regex(/^lpimg-[a-f0-9]{32}$/),
  landingPageId: z.string().uuid(),
  r2Key: z.string().regex(LANDING_IMAGE_R2_KEY_PATTERN),
  contentType: z.enum(IMAGE_CONTENT_TYPES),
  altText: z.string().max(1000).nullable().optional(),
  position: z.number().int().min(1).optional(),
  width: z.number().int().min(1).max(20000).optional(),
  height: z.number().int().min(1).max(20000).optional(),
  actor: actorSchema,
};

export const LpImageUploadPayloadSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...baseShape,
    kind: z.literal("url"),
    imageUrl: z.string().regex(/^https?:\/\//, "imageUrl must be an http(s) URL"),
  }),
  z.strictObject({
    ...baseShape,
    kind: z.literal("bytes"),
  }),
]);

export type LpImageUploadPayload = z.infer<typeof LpImageUploadPayloadSchema>;

interface StoredImageMeta {
  size: number;
  width: number | null;
  height: number | null;
  storedContentType: string;
  converted: boolean;
}

/**
 * Read a response body up to capBytes, aborting the moment the cap is
 * exceeded — an unbounded arrayBuffer() on a lying response would buffer the
 * whole payload in memory before any check runs.
 */
async function readBodyWithCap(response: Response, capBytes: number): Promise<Uint8Array> {
  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > capBytes) {
      throw new NonRetryableError(`Image exceeds the 8 MB cap (${buffer.byteLength} bytes).`);
    }
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > capBytes) {
      await reader.cancel().catch(() => {});
      throw new NonRetryableError(
        `Image exceeds the 8 MB cap (${total} bytes read so far).`,
      );
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function verifyBytes(
  bytes: Uint8Array,
  claimed: string,
  where: string,
): void {
  if (bytes.byteLength === 0) {
    throw new NonRetryableError(`${where} returned an empty body.`);
  }
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new NonRetryableError(
      `${where} exceeds the 8 MB cap (${bytes.byteLength} bytes).`,
    );
  }
  const sniffed = sniffImageType(bytes);
  if (!sniffed) {
    throw new NonRetryableError(
      `${where} are not a recognized image (png, jpeg, webp, or gif).`,
    );
  }
  if (sniffed !== claimed) {
    throw new NonRetryableError(
      `Content mismatch: ${where} served ${sniffed} but contentType claimed ${claimed}.`,
    );
  }
}

/** kind=url: download, validate, store. Throws retryable on transport errors. */
async function fetchAndStoreImage(
  params: Extract<LpImageUploadPayload, { kind: "url" }>,
): Promise<StoredImageMeta & { url: string }> {
  const claimed = canonicalImageContentType(params.contentType);
  let response: Response;
  try {
    response = await fetch(params.imageUrl, { redirect: "follow" });
  } catch (err) {
    throw new Error(`Image URL fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if ([401, 403, 404].includes(response.status)) {
    throw new NonRetryableError(
      `Image URL returned HTTP ${response.status} — the link is not publicly fetchable or has expired. ` +
        "Re-generate the image and provide its direct download URL.",
    );
  }
  if (!response.ok) {
    throw new Error(`Image URL fetch failed with HTTP ${response.status}`);
  }

  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_IMAGE_BYTES) {
    throw new NonRetryableError(
      `Image exceeds the 8 MB cap (content-length: ${declaredLength} bytes).`,
    );
  }

  const bytes = await readBodyWithCap(response, MAX_IMAGE_BYTES);
  verifyBytes(bytes, claimed, "Fetched bytes");

  const dimensions = parseImageDimensions(bytes);
  const stored = await blobPut(params.r2Key, Buffer.from(bytes), claimed);
  return {
    size: bytes.byteLength,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
    storedContentType: claimed,
    converted: claimed === "image/webp",
    url: stored.url,
  };
}

/** kind=bytes: verify the tool's direct Blob write landed, measure it. */
async function readAndMeasureObject(
  params: Extract<LpImageUploadPayload, { kind: "bytes" }>,
): Promise<StoredImageMeta & { url: string }> {
  const claimed = canonicalImageContentType(params.contentType);
  const url = await blobPublicUrl(params.r2Key);
  if (!url) {
    throw new NonRetryableError(
      `Blob object ${params.r2Key} is missing — the direct upload did not land. Retry the upload.`,
    );
  }
  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new Error(`Blob read failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!response.ok) {
    throw new Error(`Blob read failed with HTTP ${response.status}`);
  }
  const bytes = await readBodyWithCap(response, MAX_IMAGE_BYTES);
  verifyBytes(bytes, claimed, "Stored bytes");
  const dimensions = parseImageDimensions(bytes);
  return {
    size: bytes.byteLength,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
    storedContentType: claimed,
    converted: claimed === "image/webp",
    url,
  };
}

export async function runLpImageUpload(raw: unknown): Promise<
  | { skipped: true; reason: string }
  | { success: boolean; imageId: string | null }
> {
  const parsed = LpImageUploadPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    const reason = parsed.error.issues
      .map((e) => `${e.path.join(".")}: ${e.message}`)
      .join("; ");
    // No trustworthy job id — nothing to record, just don't retry.
    if (
      typeof raw === "object" && raw !== null &&
      /^lpimg-[a-f0-9]{32}$/.test((raw as Record<string, unknown>).uploadJobId as string ?? "")
    ) {
      const db = getDb();
      await markLpImageUploadFailed(
        db,
        (raw as { uploadJobId: string }).uploadJobId,
        `Invalid upload payload: ${reason}`,
      ).catch(() => {});
    }
    return { skipped: true, reason: `invalid_payload: ${reason}` };
  }
  const params = parsed.data;
  const db = getDb();

  const fail = async (reason: string, message: string) => {
    await markLpImageUploadFailed(db, params.uploadJobId, message).catch(() => {});
    return { skipped: true as const, reason };
  };

  try {
    const stored =
      params.kind === "url"
        ? await fetchAndStoreImage(params)
        : await readAndMeasureObject(params);

    const landingPage = await getLandingPageById(db, params.landingPageId);
    if (!landingPage) {
      return fail("landing_page_gone", `Landing page ${params.landingPageId} no longer exists — nothing to attach the image to.`);
    }

    const existing = (await getLandingPageImages(db, params.landingPageId)).find(
      (image) => image.r2Key === params.r2Key,
    );
    if (existing) {
      await markLpImageUploadComplete(db, params.uploadJobId, {
        imageId: existing.id,
        src: existing.src,
        position: existing.position,
        width: existing.width,
        height: existing.height,
        altText: existing.altText,
      }).catch(() => {});
      return { success: true, imageId: existing.id };
    }

    const mediaDomain = process.env.MEDIA_DOMAIN;
    const src =
      mediaDomain && mediaDomain.length > 0
        ? `https://${mediaDomain}/${params.r2Key}`
        : stored.url;
    const images = await addLandingPageImage(db, params.landingPageId, {
      r2Key: params.r2Key,
      src,
      altText: params.altText ?? null,
      ...(params.position !== undefined ? { position: params.position } : {}),
      width: stored.width ?? params.width ?? null,
      height: stored.height ?? params.height ?? null,
      source: "ai",
    });
    const image = images.find((row) => row.r2Key === params.r2Key);
    if (!image) {
      throw new Error(`Inserted image row for key ${params.r2Key} not found in the resulting stack.`);
    }

    await markLpImageUploadComplete(db, params.uploadJobId, {
      imageId: image.id,
      src: image.src,
      position: image.position,
      width: image.width,
      height: image.height,
      altText: image.altText,
    }).catch(() => {});

    await logActivity(
      db,
      params.actor,
      ACTIONS.LANDING_PAGE_UPDATED,
      { type: "landing_page", id: params.landingPageId, label: landingPage.name },
      {
        via: "qstash",
        action: "image_added",
        source: "ai",
        imageId: image.id,
        r2Key: params.r2Key,
        uploadKind: params.kind,
        uploadJobId: params.uploadJobId,
        byteSize: stored.size,
        storedContentType: stored.storedContentType,
        convertedToWebp: stored.converted,
      },
    );

    return { success: true, imageId: image.id };
  } catch (err) {
    if (err instanceof NonRetryableError) {
      return fail("terminal", err.message);
    }
    throw err;
  }
}
