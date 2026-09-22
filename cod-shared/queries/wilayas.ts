/**
 * Wilayas + Communes Queries
 *
 * Read-only reference data for Algeria's 58 wilayas and their communes.
 * Consumed by cod-server handlers and dashboard components.
 */

import { eq, ilike, asc, or } from "drizzle-orm";
import { wilayas, communes } from "../db/schema.pg";
import type { PgDb } from "../db/client.pg";

export interface WilayaFilters {
  search?: string;
}

export async function getAllWilayas(db: PgDb, filters?: WilayaFilters) {
  if (filters?.search) {
    return await db
      .select()
      .from(wilayas)
      .where(or(ilike(wilayas.name, `%${filters.search}%`), ilike(wilayas.nameAr, `%${filters.search}%`)))
      .orderBy(asc(wilayas.id))
      ;
  }

  return await db.select().from(wilayas).orderBy(asc(wilayas.id));
}

export async function getWilayaById(db: PgDb, id: number) {
  return await db.select().from(wilayas).where(eq(wilayas.id, id)).then((rows) => rows[0] ?? null);
}

export async function getCommunesByWilaya(db: PgDb, wilayaId: number) {
  return await db
    .select()
    .from(communes)
    .where(eq(communes.wilayaId, wilayaId))
    .orderBy(asc(communes.name))
    ;
}
