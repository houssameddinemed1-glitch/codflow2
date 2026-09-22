import { eq } from "drizzle-orm";
import { stores } from "../db/schema.pg";
import type { PgDb } from "../db/client.pg";

type StoreUpdate = Partial<typeof stores.$inferInsert>;

/** Single-tenant: returns the one store in this D1 database. */
export async function getStore(db: PgDb) {
  return db.select().from(stores).then((rows) => rows[0] ?? null);
}

export async function updateStore(db: PgDb, storeId: string, data: StoreUpdate) {
  const now = new Date().toISOString();
  await db
    .update(stores)
    .set({ ...data, updatedAt: now })
    .where(eq(stores.id, storeId))
    ;
  return db.select().from(stores).where(eq(stores.id, storeId)).then((rows) => rows[0] ?? null);
}
