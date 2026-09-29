import { getDb } from "@/db";
import {
  sweepPendingToAbandoned,
  purgeStaleAbandonedSiblings,
} from "../../../cod-shared/queries/abandoned-orders";

export async function sweepAbandonedOrders(): Promise<number> {
  const db = getDb();
  const count = await sweepPendingToAbandoned(db);
  let purged = 0;
  try {
    purged = await purgeStaleAbandonedSiblings(db);
  } catch (err) {
    console.error("[cron:sweep-abandoned] purge failed:", (err as Error)?.message);
  }
  console.log(`[cron:sweep-abandoned] swept ${count} pending → abandoned, purged ${purged} stale siblings`);
  return count;
}
