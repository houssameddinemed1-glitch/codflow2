import { describe, it, expect, vi, beforeEach } from "vitest";

const jobQueries = vi.hoisted(() => ({
  addLandingPageImage: vi.fn(),
  getLandingPageById: vi.fn(),
  getLandingPageImages: vi.fn(),
  markLpImageUploadComplete: vi.fn(async () => undefined),
  markLpImageUploadFailed: vi.fn(async () => undefined),
}));

vi.mock("../../../cod-shared/queries/landing-pages", () => jobQueries);

const blobMocks = vi.hoisted(() => ({
  blobPut: vi.fn(async () => ({ url: "https://blob.example/landing/x.webp", pathname: "landing/x.webp" })),
  blobPublicUrl: vi.fn(async () => null as string | null),
}));

vi.mock("@/lib/blob", () => blobMocks);

vi.mock("@/db", () => ({
  getDb: vi.fn(() => ({})),
}));

const activityMocks = vi.hoisted(() => ({
  logActivity: vi.fn(async () => undefined),
}));

vi.mock("@/lib/activity", () => ({
  ...activityMocks,
  ACTIONS: { LANDING_PAGE_UPDATED: "landing_page.updated" },
}));

import { runLpImageUpload } from "./run-lp-image-upload";

const JOB_ID = `lpimg-${"b".repeat(32)}`;
const PAGE_ID = "6f0c9b8e-3d2a-4e5f-8a7b-9c1d2e3f4a5b";
const R2_KEY = `landing/${"c".repeat(32)}.webp`;

/** Real 1x1 px PNG — sniff + dimension parsing run against real bytes. */
const PNG_1x1 = new Uint8Array(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
));

const ACTOR = { id: "user-1", name: "Ada", role: "staff" as const };

function urlPayload(overrides: Record<string, unknown> = {}) {
  return {
    uploadJobId: JOB_ID,
    kind: "url",
    landingPageId: PAGE_ID,
    r2Key: R2_KEY,
    contentType: "image/png",
    imageUrl: "https://images.example.com/gen.png",
    actor: ACTOR,
    ...overrides,
  };
}

function pngResponse(status = 200, headers: Record<string, string> = {}) {
  return new Response(PNG_1x1, {
    status,
    headers: { "content-length": String(PNG_1x1.byteLength), ...headers },
  });
}

const PAGE = { id: PAGE_ID, name: "Zinc page" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(async () => pngResponse()));
  jobQueries.getLandingPageById.mockResolvedValue(PAGE);
  jobQueries.getLandingPageImages.mockResolvedValue([]);
  const image = {
    id: "img-1",
    r2Key: R2_KEY,
    src: `https://media.example.com/${R2_KEY}`,
    position: 1,
    width: 1,
    height: 1,
    altText: null,
  };
  jobQueries.addLandingPageImage.mockResolvedValue([image]);
});

describe("runLpImageUpload", () => {
  it("rejects an invalid payload without throwing (no retry)", async () => {
    const res = await runLpImageUpload({ kind: "url" });
    expect(res).toMatchObject({ skipped: true });
    expect(jobQueries.markLpImageUploadFailed).not.toHaveBeenCalled();
    expect(blobMocks.blobPut).not.toHaveBeenCalled();
  });

  it("records failed when the job id is valid but the payload is not", async () => {
    const res = await runLpImageUpload({ uploadJobId: JOB_ID, kind: "nope" });
    expect(res).toMatchObject({ skipped: true });
    expect(jobQueries.markLpImageUploadFailed).toHaveBeenCalledWith(
      expect.anything(),
      JOB_ID,
      expect.stringContaining("Invalid upload payload"),
    );
  });

  it("url kind: downloads, stores, inserts, completes, audits", async () => {
    const res = await runLpImageUpload(urlPayload());

    expect(res).toEqual({ success: true, imageId: "img-1" });
    expect(blobMocks.blobPut).toHaveBeenCalledWith(
      R2_KEY,
      expect.any(Buffer),
      "image/png",
    );
    expect(jobQueries.addLandingPageImage).toHaveBeenCalledWith(
      expect.anything(),
      PAGE_ID,
      expect.objectContaining({ r2Key: R2_KEY, source: "ai", width: 1, height: 1 }),
    );
    expect(jobQueries.markLpImageUploadComplete).toHaveBeenCalledWith(
      expect.anything(),
      JOB_ID,
      expect.objectContaining({ imageId: "img-1" }),
    );
    expect(activityMocks.logActivity).toHaveBeenCalled();
  });

  it("url kind: reuses the existing row when the key already landed (idempotent)", async () => {
    const existing = {
      id: "img-9",
      r2Key: R2_KEY,
      src: `https://media.example.com/${R2_KEY}`,
      position: 2,
      width: 1,
      height: 1,
      altText: "Hero",
    };
    jobQueries.getLandingPageImages.mockResolvedValue([existing]);

    const res = await runLpImageUpload(urlPayload());

    expect(res).toEqual({ success: true, imageId: "img-9" });
    expect(jobQueries.addLandingPageImage).not.toHaveBeenCalled();
    expect(jobQueries.markLpImageUploadComplete).toHaveBeenCalledWith(
      expect.anything(),
      JOB_ID,
      expect.objectContaining({ imageId: "img-9" }),
    );
  });

  it("url kind: 404 from the image host fails terminally (no retry)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));

    const res = await runLpImageUpload(urlPayload());

    expect(res).toMatchObject({ skipped: true, reason: "terminal" });
    expect(jobQueries.markLpImageUploadFailed).toHaveBeenCalledWith(
      expect.anything(),
      JOB_ID,
      expect.stringContaining("not publicly fetchable"),
    );
    expect(blobMocks.blobPut).not.toHaveBeenCalled();
  });

  it("url kind: 500 from the image host throws (QStash retries)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));

    await expect(runLpImageUpload(urlPayload())).rejects.toThrow("HTTP 500");
    expect(jobQueries.markLpImageUploadFailed).not.toHaveBeenCalled();
  });

  it("bytes kind: missing blob fails terminally", async () => {
    blobMocks.blobPublicUrl.mockResolvedValue(null);

    const res = await runLpImageUpload({
      uploadJobId: JOB_ID,
      kind: "bytes",
      landingPageId: PAGE_ID,
      r2Key: R2_KEY,
      contentType: "image/png",
      actor: ACTOR,
    });

    expect(res).toMatchObject({ skipped: true, reason: "terminal" });
    expect(jobQueries.markLpImageUploadFailed).toHaveBeenCalledWith(
      expect.anything(),
      JOB_ID,
      expect.stringContaining("did not land"),
    );
  });

  it("bytes kind: verifies the stored object and completes", async () => {
    blobMocks.blobPublicUrl.mockResolvedValue("https://blob.example/landing/x.png");

    const res = await runLpImageUpload({
      uploadJobId: JOB_ID,
      kind: "bytes",
      landingPageId: PAGE_ID,
      r2Key: R2_KEY,
      contentType: "image/png",
      actor: ACTOR,
    });

    expect(res).toEqual({ success: true, imageId: "img-1" });
    expect(blobMocks.blobPut).not.toHaveBeenCalled();
  });

  it("fails terminally when the landing page is gone", async () => {
    jobQueries.getLandingPageById.mockResolvedValue(null);

    const res = await runLpImageUpload(urlPayload());

    expect(res).toMatchObject({ skipped: true, reason: "landing_page_gone" });
    expect(jobQueries.markLpImageUploadFailed).toHaveBeenCalledWith(
      expect.anything(),
      JOB_ID,
      expect.stringContaining("no longer exists"),
    );
  });
});
