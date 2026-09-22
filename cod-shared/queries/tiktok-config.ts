import type { PgDb } from "../db/client.pg";
import { storeTiktokConfig } from "../db/schema.pg";
import { eq } from "drizzle-orm";

export type TiktokConversionEvent = "Purchase" | "Purchase_Confirmed" | "Purchase_Delivered" | "Lead";

export async function getTiktokConfig(db: PgDb, storeId?: string) {
  if (storeId) {
    return db
      .select()
      .from(storeTiktokConfig)
      .where(eq(storeTiktokConfig.storeId, storeId))
      .then((rows) => rows[0] ?? null);
  }
  return db
    .select()
    .from(storeTiktokConfig)
    .limit(1)
    .then((rows) => rows[0] ?? null);
}

export interface UpsertTiktokConfigData {
  pixelId: string;
  adAccountName?: string | null;
  accessToken?: string;
  testEventCode?: string | null;
  conversionEvent?: TiktokConversionEvent;
  testMode?: boolean;
  enabled?: boolean;
}

export async function upsertTiktokConfig(
  db: PgDb,
  storeId: string,
  data: UpsertTiktokConfigData,
) {
  const now = new Date().toISOString();
  const existing = await getTiktokConfig(db, storeId);

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
      .update(storeTiktokConfig)
      .set({
        pixelId: data.pixelId,
        adAccountName,
        accessToken,
        testEventCode,
        conversionEvent: data.conversionEvent ?? existing.conversionEvent,
        testMode: data.testMode ?? existing.testMode,
        enabled: data.enabled ?? true,
        updatedAt: now,
      })
      .where(eq(storeTiktokConfig.storeId, storeId))
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
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(storeTiktokConfig).values(row);
  return row;
}
