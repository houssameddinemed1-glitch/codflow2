import type { PgDb } from "../db/client.pg";
import { storePixelConfig } from "../db/schema.pg";
import { eq } from "drizzle-orm";

export type ConversionEvent = "Purchase" | "Purchase_Confirmed" | "Purchase_Delivered" | "Lead";

export async function getPixelConfig(db: PgDb, storeId?: string) {
  if (storeId) {
    return db
      .select()
      .from(storePixelConfig)
      .where(eq(storePixelConfig.storeId, storeId))
      .then((rows) => rows[0] ?? null);
  }
  return db
    .select()
    .from(storePixelConfig)
    .limit(1)
    .then((rows) => rows[0] ?? null);
}

export interface UpsertPixelConfigData {
  pixelId: string;
  adAccountName?: string | null;
  accessToken?: string;
  testEventCode?: string | null;
  conversionEvent?: ConversionEvent;
  testMode?: boolean;
  enabled?: boolean;
  /** Master switch for per-landing-page tracking. Defaults off; edits to
   * unrelated settings must preserve the stored value. */
  perPageTrackingEnabled?: boolean;
}

export async function upsertPixelConfig(
  db: PgDb,
  storeId: string,
  data: UpsertPixelConfigData,
) {
  const now = new Date().toISOString();
  const existing = await getPixelConfig(db, storeId);

  const accessToken = data.accessToken?.trim() || existing?.accessToken || "";
  const adAccountName =
    data.adAccountName === undefined
      ? existing?.adAccountName ?? null
      : data.adAccountName?.trim() || null;
  const testEventCode =
    data.testEventCode === undefined
      ? existing?.testEventCode ?? null
      : data.testEventCode?.trim() || null;

  if (existing) {
    return db
      .update(storePixelConfig)
      .set({
        pixelId: data.pixelId,
        adAccountName,
        accessToken,
        testEventCode,
        conversionEvent: data.conversionEvent ?? existing.conversionEvent,
        testMode: data.testMode ?? existing.testMode,
        enabled: data.enabled ?? true,
        perPageTrackingEnabled: data.perPageTrackingEnabled ?? existing.perPageTrackingEnabled,
        updatedAt: now,
      })
      .where(eq(storePixelConfig.storeId, storeId))
      .returning()
      .then((rows) => rows[0] ?? null);
  }

  const row = {
    id: crypto.randomUUID(),
    storeId,
    pixelId: data.pixelId,
    adAccountName,
    accessToken,
    testEventCode,
    conversionEvent: data.conversionEvent ?? "Purchase",
    testMode: data.testMode ?? false,
    enabled: data.enabled ?? true,
    perPageTrackingEnabled: data.perPageTrackingEnabled ?? false,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(storePixelConfig).values(row);
  return row;
}
