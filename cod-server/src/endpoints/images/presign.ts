import type { Context } from "hono";
import type { AppContext } from "@/types";
import { handleUpload } from "@vercel/blob/client";

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Server-generated key namespaces. The browser proposes a pathname, but the
 * callback below only mints upload tokens for keys matching this shape —
 * clients can never obtain tokens for arbitrary prefixes.
 */
const KEY_PATTERN = /^(products|landing)\/[A-Za-z0-9-]{32}\.(jpg|png|webp|gif)$/;

/**
 * POST /api/images/blob-callback
 * Token endpoint for @vercel/blob/client direct browser uploads.
 * The dashboard calls upload(pathname, file, { handleUploadUrl }) — the SDK
 * POSTs here first; we mint a scoped token only for well-shaped keys, then
 * the bytes travel straight to Blob, bypassing the function entirely
 * (required: serverless functions cap request bodies well below 10 MB).
 */
export async function handleBlobUpload(c: Context<AppContext>) {
  const body = await c.req.json();
  const result = await handleUpload({
    body,
    request: c.req.raw,
    onBeforeGenerateToken: async (pathname: string) => {
      if (!KEY_PATTERN.test(pathname)) {
        throw new Error("Invalid key shape");
      }
      return {
        allowedContentTypes: Array.from(ALLOWED_TYPES),
        maximumSizeInBytes: MAX_SIZE_BYTES,
        validUntil: Date.now() + TOKEN_TTL_MS,
      };
    },
    onUploadCompleted: async () => {},
  });
  return c.json(result);
}
