import type { AppDb } from "../db/client";
import { storeFormConfig } from "../db/schema";
import { eq } from "drizzle-orm";

/** Order form variant keys. "default" is the untouched OrderForm; "form_a"+ are theme variations. */
export type FormVariant = "default" | "form_a";

export const FORM_VARIANTS: FormVariant[] = ["default", "form_a"];

export async function getFormConfig(db: AppDb, storeId?: string) {
  if (storeId) {
    return db
      .select()
      .from(storeFormConfig)
      .where(eq(storeFormConfig.storeId, storeId))
      .then((rows) => rows[0] ?? null);
  }
  return db.select().from(storeFormConfig).limit(1).then((rows) => rows[0] ?? null);
}

export async function upsertFormConfig(
  db: AppDb,
  storeId: string,
  data: { variant: FormVariant },
) {
  const now = new Date().toISOString();
  const existing = await getFormConfig(db, storeId);

  if (existing) {
    return db
      .update(storeFormConfig)
      .set({ variant: data.variant, updatedAt: now })
      .where(eq(storeFormConfig.storeId, storeId))
      .returning()
      .then((rows) => rows[0] ?? null);
  }

  const row = {
    id: crypto.randomUUID(),
    storeId,
    variant: data.variant,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(storeFormConfig).values(row);
  return row;
}
