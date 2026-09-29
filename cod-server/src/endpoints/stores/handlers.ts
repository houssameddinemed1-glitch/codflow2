import { Context } from "hono";
import type { AppContext } from "@/types";
import { getDb } from "@/db";
import * as queries from "./queries";
import { updateStoreSchema } from "./validation";
import { NotFoundError, SystemError, ValidationError, ExternalApiError } from "@/lib/errors/classes";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import { getPixelConfig as queryPixelConfig, upsertPixelConfig } from "../../../../cod-shared/queries/pixel-config";
import { getTiktokConfig as queryTiktokConfig, upsertTiktokConfig } from "../../../../cod-shared/queries/tiktok-config";
import { getFormConfig as queryFormConfig, upsertFormConfig, FORM_VARIANTS } from "../../../../cod-shared/queries/form-config";
import { getOtpConfigRaw, upsertOtpConfig } from "../../../../cod-shared/queries/otp-config";
import { getTurnstileConfigRaw, upsertTurnstileConfig } from "../../../../cod-shared/queries/turnstile-config";
import { getEmailConfigRaw, upsertEmailConfig } from "../../../../cod-shared/queries/email-config";
import { createDzverifyClient, DzverifyError, DZVERIFY_ERRORS } from "@/endpoints/store-otp/dzverify";
import { createSendiliClient, SendiliError, SENDILI_ERRORS } from "../../../../cod-shared/lib/sendili";
import { maskApiKey } from "@/lib/mask";
import { z } from "zod";

export async function getMyStore(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const store = await queries.getStore(db);
  
  if (!store) {
    throw new NotFoundError("Store");
  }
  
  return c.json({ success: true, data: store }, 200);
}

export async function updateMyStore(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const store = await queries.getStore(db);

  if (!store) {
    throw new NotFoundError("Store");
  }

  const jsonBody: any = (c.req as any).valid?.("json");
  const validated = jsonBody ?? updateStoreSchema.parse(await c.req.json());
  const updated = await queries.updateStore(db, store.id, validated);
  if (!updated) {
    throw new SystemError("Failed to update store");
  }
  return c.json({ success: true, data: updated }, 200);
}

const pixelConfigSchema = z.object({
  pixelId: z.string().min(1),
  adAccountName: z.string().max(200).nullable().optional(),
  accessToken: z.string().default(""),
  testEventCode: z.string().nullable().optional(),
  conversionEvent: z.enum(["Purchase", "Purchase_Confirmed", "Purchase_Delivered", "Lead"]),
  testMode: z.boolean().optional(),
  enabled: z.boolean().optional(),
  perPageTrackingEnabled: z.boolean().optional(),
});

/** Safe projection — the access token never leaves the API, only a masked hint. */
function pixelConfigResponse(row: NonNullable<Awaited<ReturnType<typeof queryPixelConfig>>>) {
  return {
    id: row.id,
    storeId: row.storeId,
    pixelId: row.pixelId,
    adAccountName: row.adAccountName,
    accessTokenMasked: maskApiKey(row.accessToken),
    testEventCode: row.testEventCode,
    conversionEvent: row.conversionEvent,
    testMode: row.testMode,
    enabled: row.enabled,
    perPageTrackingEnabled: row.perPageTrackingEnabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getPixelConfig(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const store = await queries.getStore(db);
  if (!store) throw new NotFoundError("Store");
  const config = await queryPixelConfig(db, store.id);
  return c.json({ success: true, data: config ? pixelConfigResponse(config) : null }, 200);
}

export async function savePixelConfig(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const store = await queries.getStore(db);
  if (!store) throw new NotFoundError("Store");
  const jsonBody: any = (c.req as any).valid?.("json");
  const validated = jsonBody ?? pixelConfigSchema.parse(await c.req.json());
  const result = await upsertPixelConfig(db, store.id, validated);
  if (!result) {
    throw new SystemError("Failed to save pixel config");
  }
  return c.json({ success: true, data: pixelConfigResponse(result) }, 200);
}

// ─── TikTok Pixel + Events API config ───────────────────────────────────────
// Fully separate from the Meta pixel config above: own table, own token, own
// conversion-event choice. TikTok data never mixes with Meta data.

const tiktokConfigSchema = z.object({
  pixelId: z.string().min(1),
  adAccountName: z.string().max(200).nullable().optional(),
  accessToken: z.string().default(""),
  testEventCode: z.string().nullable().optional(),
  conversionEvent: z.enum(["Purchase", "Purchase_Confirmed", "Purchase_Delivered", "Lead"]),
  testMode: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

/** Safe projection — the access token never leaves the API, only a masked hint. */
function tiktokConfigResponse(row: NonNullable<Awaited<ReturnType<typeof queryTiktokConfig>>>) {
  return {
    id: row.id,
    storeId: row.storeId,
    pixelId: row.pixelId,
    adAccountName: row.adAccountName,
    accessTokenMasked: maskApiKey(row.accessToken),
    testEventCode: row.testEventCode,
    conversionEvent: row.conversionEvent,
    testMode: row.testMode,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getTiktokConfig(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const store = await queries.getStore(db);
  if (!store) throw new NotFoundError("Store");
  const config = await queryTiktokConfig(db, store.id);
  return c.json({ success: true, data: config ? tiktokConfigResponse(config) : null }, 200);
}

export async function saveTiktokConfig(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const store = await queries.getStore(db);
  if (!store) throw new NotFoundError("Store");
  const jsonBody: any = (c.req as any).valid?.("json");
  const validated = jsonBody ?? tiktokConfigSchema.parse(await c.req.json());
  const result = await upsertTiktokConfig(db, store.id, validated);
  if (!result) {
    throw new SystemError("Failed to save TikTok config");
  }
  return c.json({ success: true, data: tiktokConfigResponse(result) }, 200);
}

// ─── Order form variation ───────────────────────────────────────────────────
// Stores only the active variant key; the designs live in the theme layer.
// Unknown/future keys are rejected — add the design first, then extend FORM_VARIANTS.

function formConfigResponse(row: NonNullable<Awaited<ReturnType<typeof queryFormConfig>>>) {
  return {
    id: row.id,
    storeId: row.storeId,
    variant: row.variant,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getFormConfig(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const store = await queries.getStore(db);
  if (!store) throw new NotFoundError("Store");
  const config = await queryFormConfig(db, store.id);
  return c.json({ success: true, data: config ? formConfigResponse(config) : null }, 200);
}

export async function saveFormConfig(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const store = await queries.getStore(db);
  if (!store) throw new NotFoundError("Store");
  const jsonBody: any = (c.req as any).valid?.("json");
  const raw = jsonBody ?? (await c.req.json());
  const variant = (raw as { variant?: unknown }).variant;
  if (typeof variant !== "string" || !(FORM_VARIANTS as readonly string[]).includes(variant)) {
    throw new ValidationError(
      `Unknown form variant "${String(variant)}" — expected one of: ${FORM_VARIANTS.join(", ")}`,
      ERROR_CODES.INVALID_FORMAT,
    );
  }
  const result = await upsertFormConfig(db, store.id, { variant: variant as (typeof FORM_VARIANTS)[number] });
  if (!result) {
    throw new SystemError("Failed to save form config");
  }
  return c.json({ success: true, data: formConfigResponse(result) }, 200);
}

// ─── WhatsApp OTP verification config (dzverify) ──────────────────────────────

const otpConfigSchema = z.object({
  /** Empty string = keep the existing stored key (dashboard never re-sends it). */
  apiKey: z.string().default(""),
  language: z.enum(["en", "fr", "ar"]).optional(),
  enabled: z.boolean().optional(),
});

/** Response shape: the safe config plus a masked key hint for the UI. maskApiKey lives in @/lib/mask. */

export async function getOtpConfig(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const store = await queries.getStore(db);
  if (!store) throw new NotFoundError("Store");

  const raw = await getOtpConfigRaw(db, store.id);
  if (!raw) return c.json({ success: true, data: null }, 200);

  return c.json(
    {
      success: true,
      data: {
        language: raw.language,
        enabled: raw.enabled,
        apiKeyMasked: maskApiKey(raw.apiKey),
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
      },
    },
    200
  );
}

export async function saveOtpConfig(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const store = await queries.getStore(db);
  if (!store) throw new NotFoundError("Store");

  const jsonBody: any = (c.req as any).valid?.("json");
  const validated = jsonBody ?? otpConfigSchema.parse(await c.req.json());

  const existing = await getOtpConfigRaw(db, store.id);
  const apiKey = validated.apiKey.trim() || existing?.apiKey || "";
  if (!apiKey) {
    throw new ValidationError(
      "A dzverify API key is required to enable WhatsApp OTP verification",
      ERROR_CODES.REQUIRED_FIELD_MISSING
    );
  }

  const result = await upsertOtpConfig(db, store.id, {
    apiKey,
    language: validated.language,
    enabled: validated.enabled,
  });

  return c.json(
    {
      success: true,
      data: {
        language: result.language,
        enabled: result.enabled,
        apiKeyMasked: maskApiKey(apiKey),
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
      },
    },
    200
  );
}

/**
 * POST /api/stores/otp-config/test
 * Checks the stored (or submitted) dzverify key against the quota endpoint.
 * A working key without the usage:read scope is reported as
 * "key valid, quota unavailable" rather than a failure.
 */
export async function testOtpConnection(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const store = await queries.getStore(db);
  if (!store) throw new NotFoundError("Store");

  const jsonBody: any = (c.req as any).valid?.("json");
  const submittedKey = (jsonBody?.apiKey ?? "").trim();
  const existing = await getOtpConfigRaw(db, store.id);
  const apiKey = submittedKey || existing?.apiKey;
  if (!apiKey) {
    throw new ValidationError(
      "Save a dzverify API key first",
      ERROR_CODES.REQUIRED_FIELD_MISSING
    );
  }

  const client = createDzverifyClient(apiKey);
  try {
    const quota = await client.getQuota();
    return c.json(
      {
        success: true,
        data: {
          ok: true,
          balanceDa: quota.balanceDa,
          otpEstimate: quota.otpEstimate,
          plan: quota.plan,
        },
      },
      200
    );
  } catch (err) {
    if (err instanceof DzverifyError) {
      if (err.code === DZVERIFY_ERRORS.UNAUTHORIZED) {
        return c.json(
          { success: true, data: { ok: false, reason: "invalid_key", message: "The API key was rejected by dzverify" } },
          200
        );
      }
      if (err.code === DZVERIFY_ERRORS.FORBIDDEN) {
        return c.json(
          {
            success: true,
            data: {
              ok: true,
              reason: "quota_scope_missing",
              message: "Key is valid but lacks the usage:read scope — quota preview unavailable",
            },
          },
          200
        );
      }
      return c.json(
        {
          success: true,
          data: {
            ok: false,
            reason: err.code,
            message: err.message,
            ...(err.isOutOfCredits ? { outOfCredits: true } : {}),
          },
        },
        200
      );
    }
    throw new ExternalApiError("dzverify", err instanceof Error ? err.message : "Connection check failed");
  }
}

// ─── Cloudflare Turnstile config (checkout bot protection) ────────────────────

const turnstileConfigSchema = z.object({
  /** Empty string = keep the existing stored value (the secret never round-trips to clients). */
  siteKey: z.string().default(""),
  secretKey: z.string().default(""),
  enabled: z.boolean().optional(),
});

export async function getTurnstileConfig(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const store = await queries.getStore(db);
  if (!store) throw new NotFoundError("Store");

  const raw = await getTurnstileConfigRaw(db, store.id);
  if (!raw) return c.json({ success: true, data: null }, 200);

  return c.json(
    {
      success: true,
      data: {
        siteKey: raw.siteKey,
        enabled: raw.enabled,
        secretKeyMasked: maskApiKey(raw.secretKey),
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
      },
    },
    200
  );
}

export async function saveTurnstileConfig(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const store = await queries.getStore(db);
  if (!store) throw new NotFoundError("Store");

  const jsonBody: any = (c.req as any).valid?.("json");
  const validated = jsonBody ?? turnstileConfigSchema.parse(await c.req.json());

  const existing = await getTurnstileConfigRaw(db, store.id);
  const siteKey = validated.siteKey.trim() || existing?.siteKey || "";
  const secretKey = validated.secretKey.trim() || existing?.secretKey || "";
  if (!siteKey || !secretKey) {
    throw new ValidationError(
      "Both the Turnstile site key and secret key are required to enable checkout bot protection",
      ERROR_CODES.REQUIRED_FIELD_MISSING
    );
  }

  const result = await upsertTurnstileConfig(db, store.id, {
    siteKey,
    secretKey,
    enabled: validated.enabled,
  });

  return c.json(
    {
      success: true,
      data: {
        siteKey: result.siteKey,
        enabled: result.enabled,
        secretKeyMasked: maskApiKey(secretKey),
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
      },
    },
    200
  );
}

// ─── Sendili transactional email config ──────────────────────────────────────

const emailConfigSchema = z.object({
  /** Empty string = keep the existing stored key (dashboard never re-sends it). */
  apiKey: z.string().default(""),
  fromEmail: z.string().email(),
  fromName: z.string().max(200).nullable().optional(),
  enabled: z.boolean().optional(),
});

export async function getEmailConfig(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const store = await queries.getStore(db);
  if (!store) throw new NotFoundError("Store");

  const raw = await getEmailConfigRaw(db, store.id);
  if (!raw) return c.json({ success: true, data: null }, 200);

  return c.json(
    {
      success: true,
      data: {
        fromEmail: raw.fromEmail,
        fromName: raw.fromName,
        enabled: raw.enabled,
        apiKeyMasked: maskApiKey(raw.apiKey),
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
      },
    },
    200
  );
}

export async function saveEmailConfig(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const store = await queries.getStore(db);
  if (!store) throw new NotFoundError("Store");

  const jsonBody: any = (c.req as any).valid?.("json");
  const validated = jsonBody ?? emailConfigSchema.parse(await c.req.json());

  const existing = await getEmailConfigRaw(db, store.id);
  const apiKey = validated.apiKey.trim() || existing?.apiKey || "";
  if (!apiKey) {
    throw new ValidationError(
      "A Sendili API key is required to configure email sending",
      ERROR_CODES.REQUIRED_FIELD_MISSING
    );
  }

  const result = await upsertEmailConfig(db, store.id, {
    apiKey,
    fromEmail: validated.fromEmail,
    fromName: validated.fromName,
    enabled: validated.enabled,
  });

  return c.json(
    {
      success: true,
      data: {
        fromEmail: result.fromEmail,
        fromName: result.fromName,
        enabled: result.enabled,
        apiKeyMasked: maskApiKey(apiKey),
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
      },
    },
    200
  );
}

/**
 * POST /api/stores/email-config/test
 * Checks the stored (or submitted) Sendili key against GET /v1/account and
 * returns the verified sending domains so the dashboard can populate its
 * from-address picker. Negative outcomes return 200 with ok:false — the
 * check itself succeeded.
 */
export async function testEmailConnection(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const store = await queries.getStore(db);
  if (!store) throw new NotFoundError("Store");

  const jsonBody: any = (c.req as any).valid?.("json");
  const submittedKey = (jsonBody?.apiKey ?? "").trim();
  const existing = await getEmailConfigRaw(db, store.id);
  const apiKey = submittedKey || existing?.apiKey;
  if (!apiKey) {
    throw new ValidationError(
      "Save a Sendili API key first",
      ERROR_CODES.REQUIRED_FIELD_MISSING
    );
  }

  const client = createSendiliClient(apiKey);
  try {
    const account = await client.getAccount();
    return c.json(
      {
        success: true,
        data: {
          ok: true,
          domains: account.domains,
          account: account.raw,
        },
      },
      200
    );
  } catch (err) {
    if (err instanceof SendiliError) {
      if (err.code === SENDILI_ERRORS.UNAUTHORIZED) {
        return c.json(
          { success: true, data: { ok: false, reason: "invalid_key", message: "The API key was rejected by Sendili" } },
          200
        );
      }
      return c.json(
        {
          success: true,
          data: {
            ok: false,
            reason: err.code,
            message: err.message,
            ...(err.isOutOfCredits ? { outOfCredits: true } : {}),
          },
        },
        200
      );
    }
    throw new ExternalApiError("sendili", err instanceof Error ? err.message : "Connection check failed");
  }
}
