import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { R2Bucket } from "@cloudflare/workers-types";

/**
 * R2 object-storage seam (Cloudflare-native).
 *
 * Writes go through the IMAGES bucket binding; reads are served from the
 * binding or redirected to the MEDIA_DOMAIN custom domain. Browser direct
 * uploads use S3 presigned PUTs (see endpoints/images/presign.ts).
 *
 * The binding is per-request env, but every request of a deployment carries
 * the same bucket object — configureBlobStorage() (called once per request
 * from the global middleware in src/index.ts) keeps the historical 3-arg
 * call shape working. Pass an explicit override to bypass the default.
 */

export interface BlobStorage {
  bucket?: R2Bucket;
  mediaDomain?: string | null;
  /** Fallback base for /images URLs when no media domain is set (dev). */
  workerUrl?: string | null;
}

let defaultStorage: BlobStorage | undefined;

/** Set the deployment-wide default storage (idempotent — same every request). */
export function configureBlobStorage(storage: BlobStorage): void {
  if (storage.bucket) defaultStorage = storage;
}

function storageOf(override?: BlobStorage): Required<Pick<BlobStorage, "bucket">> & BlobStorage {
  const s = override ?? defaultStorage;
  if (!s?.bucket) throw new Error("R2 bucket not configured");
  return s as Required<Pick<BlobStorage, "bucket">> & BlobStorage;
}

/** Public URL for a key: custom domain when set, else the /images route. */
export function publicUrlFor(key: string, storage?: BlobStorage): string {
  const s = overrideOrDefault(storage);
  const clean = key.replace(/^\/+/, "");
  if (s.mediaDomain) return `https://${s.mediaDomain}/${clean}`;
  const base = (s.workerUrl ?? "").replace(/\/+$/, "");
  return base ? `${base}/images/${clean}` : `/images/${clean}`;
}

function overrideOrDefault(storage?: BlobStorage): BlobStorage {
  return storage ?? defaultStorage ?? {};
}

const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

export async function blobPut(
  pathname: string,
  body: ArrayBuffer | Uint8Array | Blob | string,
  contentType: string,
  override?: BlobStorage,
): Promise<{ url: string; pathname: string }> {
  const s = storageOf(override);
  const bytes =
    typeof Blob !== "undefined" && body instanceof Blob ? await body.arrayBuffer() : body;
  await s.bucket.put(pathname, bytes as ArrayBuffer, {
    httpMetadata: { contentType, cacheControl: IMMUTABLE_CACHE },
  });
  return { url: publicUrlFor(pathname, s), pathname };
}

export async function blobDel(pathnameOrUrl: string, override?: BlobStorage): Promise<void> {
  const s = storageOf(override);
  await s.bucket.delete(storageKeyOf(pathnameOrUrl));
}

export async function blobContentType(
  pathnameOrUrl: string,
  override?: BlobStorage,
): Promise<string | null> {
  const s = storageOf(override);
  try {
    const head = await s.bucket.head(storageKeyOf(pathnameOrUrl));
    return head?.httpMetadata?.contentType || null;
  } catch {
    return null;
  }
}

/** Authoritative public URL for an exact pathname, or null when absent. */
export async function blobPublicUrl(
  pathname: string,
  override?: BlobStorage,
): Promise<string | null> {
  const s = storageOf(override);
  try {
    const head = await s.bucket.head(pathname);
    return head ? publicUrlFor(pathname, s) : null;
  } catch {
    return null;
  }
}

/** Read an object's bytes (no-media-domain path). Objects are upload-capped
 *  at 10 MB, so buffering is safe. Returns null when the key is absent. */
export async function blobStream(
  pathname: string,
  override?: BlobStorage,
): Promise<{ bytes: ArrayBuffer; contentType: string | null; etag: string } | null> {
  const s = storageOf(override);
  const obj = await s.bucket.get(pathname);
  if (!obj) return null;
  return {
    bytes: await obj.arrayBuffer(),
    contentType: obj.httpMetadata?.contentType ?? null,
    etag: obj.etag,
  };
}

/** Accept a bare key or a full URL — always resolve to the object key. */
export function storageKeyOf(pathnameOrUrl: string): string {
  try {
    if (/^https?:\/\//.test(pathnameOrUrl)) {
      return new URL(pathnameOrUrl).pathname.replace(/^\/+/, "");
    }
  } catch {
    // Not a URL — treat as a key below.
  }
  return pathnameOrUrl.replace(/^\/+/, "");
}

export interface S3PresignConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
}

/** S3 client pointed at this account's R2 endpoint (presign flows only). */
export function r2PresignClient(cfg: S3PresignConfig): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
}

/** Ten-minute browser PUT URL for a server-minted key. */
export async function presignPutUrl(
  cfg: S3PresignConfig,
  key: string,
  contentType: string,
  expiresIn = 600,
): Promise<string> {
  const client = r2PresignClient(cfg);
  try {
    return await getSignedUrl(
      client,
      new PutObjectCommand({ Bucket: cfg.bucketName, Key: key, ContentType: contentType }),
      { expiresIn },
    );
  } finally {
    client.destroy();
  }
}
