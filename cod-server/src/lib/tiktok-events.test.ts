import { describe, it, expect, afterEach, vi } from "vitest";
import { sendTiktokEvent, type TiktokEventPayload } from "./tiktok-events";

/**
 * TikTok Events API client — payload shape, hashing/normalisation, and error
 * classification. SHA-256 vectors use the same recipe as the Meta client
 * (lowercase, whitespace-stripped inputs) with E.164 phone form (+213…).
 */

const PIXEL = "D0ABC1234567890DEF123";
const TOKEN = "tt-test-token";

function basePayload(overrides: Partial<TiktokEventPayload> = {}): TiktokEventPayload {
  return {
    eventName: "CompletePayment",
    eventId: "order-1",
    eventTime: 1700000000,
    userData: { phone: "0555123456" },
    value: 5000,
    currency: "DZD",
    contentIds: ["prod-1"],
    ...overrides,
  };
}

function tiktokOk() {
  return new Response(JSON.stringify({ code: 0, message: "OK" }), { status: 200 });
}

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: any;
}

function stubFetch(response: () => Response): Captured {
  const captured: Captured = { url: "", headers: {}, body: null };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      captured.url = url;
      captured.headers = Object.fromEntries(new Headers(init.headers).entries());
      captured.body = JSON.parse(init.body as string);
      return response();
    })
  );
  return captured;
}

afterEach(() => vi.unstubAllGlobals());

describe("sendTiktokEvent — request shape", () => {
  it("posts to the TikTok pixel/track endpoint with the token in the header, never the URL", async () => {
    const captured = stubFetch(tiktokOk);
    await sendTiktokEvent(PIXEL, TOKEN, basePayload());
    expect(captured.url).toBe("https://business-api.tiktok.com/open_api/v1.3/pixel/track/");
    expect(captured.headers["access-token"]).toBe(TOKEN);
    expect(captured.url).not.toContain(TOKEN);
  });

  it("sends the canonical event envelope with ISO timestamp", async () => {
    const captured = stubFetch(tiktokOk);
    await sendTiktokEvent(PIXEL, TOKEN, basePayload({ eventSourceUrl: "https://store.example/thank-you" }));
    expect(captured.body.pixel_code).toBe(PIXEL);
    expect(captured.body.event).toBe("CompletePayment");
    expect(captured.body.event_id).toBe("order-1");
    expect(captured.body.timestamp).toBe("2023-11-14T22:13:20.000Z");
    expect(captured.body.context.page).toEqual({ url: "https://store.example/thank-you" });
    expect(captured.body.properties).toMatchObject({
      value: 5000,
      currency: "DZD",
      content_type: "product",
      contents: [{ content_id: "prod-1" }],
    });
  });

  it("hashes the E.164 phone and external id, sends IP/UA in plaintext", async () => {
    const captured = stubFetch(tiktokOk);
    await sendTiktokEvent(
      PIXEL,
      TOKEN,
      basePayload({
        userData: {
          phone: "0555123456",
          externalId: "cust-123",
          clientIpAddress: "197.1.2.3",
          clientUserAgent: "Mozilla/5.0",
        },
      })
    );
    const user = captured.body.context.user;
    // +213555123456 hashed — 64 hex chars, not the raw digits
    expect(user.phone_number).toMatch(/^[0-9a-f]{64}$/);
    expect(user.phone_number).not.toContain("555123456");
    expect(user.external_id).toMatch(/^[0-9a-f]{64}$/);
    expect(captured.body.context.ip).toBe("197.1.2.3");
    expect(captured.body.context.user_agent).toBe("Mozilla/5.0");
  });

  it("omits properties for SubmitForm without value", async () => {
    const captured = stubFetch(tiktokOk);
    await sendTiktokEvent(
      PIXEL,
      TOKEN,
      basePayload({ eventName: "SubmitForm", value: undefined, contentIds: undefined })
    );
    expect(captured.body.event).toBe("SubmitForm");
    expect(captured.body.properties).toBeUndefined();
  });

  it("attaches test_event_code only when provided", async () => {
    const withCode = stubFetch(tiktokOk);
    await sendTiktokEvent(PIXEL, TOKEN, basePayload({ testEventCode: "TEST123" }));
    expect(withCode.body.test_event_code).toBe("TEST123");

    const withoutCode = stubFetch(tiktokOk);
    await sendTiktokEvent(PIXEL, TOKEN, basePayload());
    expect(withoutCode.body.test_event_code).toBeUndefined();
  });
});

describe("sendTiktokEvent — error classification", () => {
  it("throws on network errors (retryable by the Workflow)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("boom"); }));
    await expect(sendTiktokEvent(PIXEL, TOKEN, basePayload())).rejects.toThrow(
      "TikTok Events API network error"
    );
  });

  it("throws on TikTok 5xx (retryable by the Workflow)", async () => {
    stubFetch(() => new Response(JSON.stringify({ code: -1, message: "busy" }), { status: 500 }));
    await expect(sendTiktokEvent(PIXEL, TOKEN, basePayload())).rejects.toThrow(
      "TikTok Events API server error 500"
    );
  });

  it("returns success:false on TikTok error codes (payload rejected)", async () => {
    stubFetch(() => new Response(JSON.stringify({ code: 40001, message: "pixel not found" }), { status: 200 }));
    const result = await sendTiktokEvent(PIXEL, TOKEN, basePayload());
    expect(result).toMatchObject({ success: false, error: "pixel not found" });
  });

  it("returns success:true on code 0", async () => {
    stubFetch(tiktokOk);
    const result = await sendTiktokEvent(PIXEL, TOKEN, basePayload());
    expect(result).toEqual({ success: true });
  });
});
