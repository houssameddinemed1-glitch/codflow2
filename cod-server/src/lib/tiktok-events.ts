/**
 * TikTok Events API client (server-to-server).
 *
 * Mirrors the Meta CAPI client (./capi.ts) but talks only to TikTok —
 * pixel code, access token, and events never cross platforms.
 *
 * Endpoint: POST https://business-api.tiktok.com/open_api/v1.3/pixel/track/
 * Auth:     `Access-Token` request header (never in the URL).
 * Dedup:    TikTok dedupes on pixel_code + event + event_id — the browser
 *           ttq call and this server call MUST share the same event_id
 *           (the order ID) and the same event name.
 *
 * All PII is SHA-256 hashed before sending (TikTok requirement for
 * email/phone). IP and user agent travel in plaintext (TikTok requirement).
 * Phones are normalised to the Algerian country code 213, E.164 form (+213…).
 * Throws on network errors and TikTok 5xx (retryable by the Workflow);
 * returns { success: false } on 4xx (TikTok rejects the payload).
 */

const TIKTOK_API_BASE = "https://business-api.tiktok.com";
const TIKTOK_TRACK_PATH = "/open_api/v1.3/pixel/track/";
const DZ_COUNTRY_CODE = "213";

async function sha256hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value.toLowerCase().replace(/\s+/g, ""));
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** E.164 digits for hashing: strips local trunk 0, forces +213. Returns the hash input WITH leading +. */
function normalisePhoneE164(raw: string): string {
  let p = raw.replace(/\D/g, "");
  p = p.replace(/^0+/, "");
  if (!p.startsWith(DZ_COUNTRY_CODE)) p = DZ_COUNTRY_CODE + p;
  return `+${p}`;
}

export type TiktokEventName = "CompletePayment" | "SubmitForm";

export interface TiktokUserData {
  phone: string;
  externalId?: string | null;
  clientIpAddress?: string | null;
  clientUserAgent?: string | null;
}

export interface TiktokEventPayload {
  eventName: TiktokEventName;
  eventId: string;
  eventTime: number;
  /** Thank-you page URL — recommended by TikTok for web events. */
  eventSourceUrl?: string | null;
  userData: TiktokUserData;
  /** DZD value — sent for CompletePayment */
  value?: number;
  currency?: string;
  contentIds?: string[];
  testEventCode?: string | null;
}

export interface TiktokResult {
  success: boolean;
  error?: string;
}

export async function sendTiktokEvent(
  pixelCode: string,
  accessToken: string,
  payload: TiktokEventPayload,
): Promise<TiktokResult> {
  const ud = payload.userData;

  const user: Record<string, string> = {
    phone_number: await sha256hex(normalisePhoneE164(ud.phone)),
  };
  if (ud.externalId) user.external_id = await sha256hex(ud.externalId);

  const context: Record<string, unknown> = {
    user,
  };
  if (ud.clientIpAddress) context.ip = ud.clientIpAddress;
  if (ud.clientUserAgent) context.user_agent = ud.clientUserAgent;
  if (payload.eventSourceUrl) {
    context.page = { url: payload.eventSourceUrl };
  }

  const body: Record<string, unknown> = {
    pixel_code: pixelCode,
    event: payload.eventName,
    event_id: payload.eventId,
    timestamp: new Date(payload.eventTime * 1000).toISOString(),
    context,
  };

  if (payload.value !== undefined) {
    body.properties = {
      value: payload.value,
      currency: payload.currency ?? "DZD",
      content_type: "product",
      ...(payload.contentIds?.length
        ? {
            contents: payload.contentIds.map((content_id) => ({ content_id })),
          }
        : {}),
    };
  }

  if (payload.testEventCode) body.test_event_code = payload.testEventCode;

  let res: Response;
  try {
    res = await fetch(`${TIKTOK_API_BASE}${TIKTOK_TRACK_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Access-Token": accessToken,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`TikTok Events API network error: ${err instanceof Error ? err.message : String(err)}`);
  }

  const json = (await res.json().catch(() => null)) as any;
  if (res.status >= 500) {
    throw new Error(`TikTok Events API server error ${res.status}: ${json?.message ?? "no message"}`);
  }
  if (json?.code !== 0) {
    return { success: false, error: json?.message ?? `code ${json?.code ?? res.status}` };
  }

  return { success: true };
}
