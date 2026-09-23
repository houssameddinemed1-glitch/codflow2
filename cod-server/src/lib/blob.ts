import { put, del, head, list } from "@vercel/blob";

/**
 * Vercel Blob storage seam (replaces the R2 bucket binding).
 *
 * On Vercel the SDK authenticates itself via OIDC — no token needed. Locally
 * (and in CI) BLOB_READ_WRITE_TOKEN must be set; it is injected automatically
 * when the store is connected to the project.
 */

const IMMUTABLE_CACHE_SECONDS = 31536000;

function tokenOption(): { token: string } | Record<string, never> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  return token ? { token } : {};
}

export async function blobPut(
  pathname: string,
  body: ArrayBuffer | Uint8Array | Blob | string,
  contentType: string,
): Promise<{ url: string; pathname: string }> {
  const blob = await put(pathname, body as string | Blob, {
    access: "public",
    contentType,
    cacheControlMaxAge: IMMUTABLE_CACHE_SECONDS,
    addRandomSuffix: false,
    ...tokenOption(),
  });
  return { url: blob.url, pathname: blob.pathname };
}

export async function blobDel(pathnameOrUrl: string): Promise<void> {
  await del(pathnameOrUrl, tokenOption());
}

export async function blobContentType(
  pathnameOrUrl: string,
): Promise<string | null> {
  try {
    const meta = await head(pathnameOrUrl, tokenOption());
    return meta.contentType || null;
  } catch {
    return null;
  }
}

/** Authoritative public URL for an exact pathname, or null when absent. */
export async function blobPublicUrl(pathname: string): Promise<string | null> {
  try {
    const { blobs } = await list({ prefix: pathname, limit: 10, ...tokenOption() });
    return blobs.find((b) => b.pathname === pathname)?.url ?? null;
  } catch {
    return null;
  }
}
