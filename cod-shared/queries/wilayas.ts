/**
 * Wilayas + Communes Queries
 *
 * Read-only reference data for Algeria's 58 wilayas and their communes.
 * Consumed by cod-server handlers and dashboard components.
 */

import { eq, asc, or } from "drizzle-orm";
import { ilikeFold } from "../lib/search";
import { wilayas, communes } from "../db/schema";
import type { AppDb } from "../db/client";

export interface WilayaFilters {
  search?: string;
}

export async function getAllWilayas(db: AppDb, filters?: WilayaFilters) {
  if (filters?.search) {
    return await db
      .select()
      .from(wilayas)
      .where(or(ilikeFold(wilayas.name, `%${filters.search}%`), ilikeFold(wilayas.nameAr, `%${filters.search}%`)))
      .orderBy(asc(wilayas.id))
      ;
  }

  return await db.select().from(wilayas).orderBy(asc(wilayas.id));
}

export async function getWilayaById(db: AppDb, id: number) {
  return await db.select().from(wilayas).where(eq(wilayas.id, id)).then((rows) => rows[0] ?? null);
}

export async function getCommunesByWilaya(db: AppDb, wilayaId: number) {
  return await db
    .select()
    .from(communes)
    .where(eq(communes.wilayaId, wilayaId))
    .orderBy(asc(communes.name))
    ;
}
