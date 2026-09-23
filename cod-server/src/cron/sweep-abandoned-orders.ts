import { getDb } from "@/db";
import { sweepPendingToAbandoned } from "../../../cod-shared/queries/abandoned-orders";

export async function sweepAbandonedOrders(): Promise<number> {
  const db = getDb();
  const count = await sweepPendingToAbandoned(db);
  console.log(`[cron:sweep-abandoned] swept ${count} pending → abandoned`);
  return count;
}
