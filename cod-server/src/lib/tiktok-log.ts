import { tiktokEventLog } from "@/db/schema";
import type { getDb } from "@/db";

export type TiktokLogStatus = "sent" | "failed" | "skipped" | "claimed";

export interface TiktokLogEntry {
  orderId: string;
  eventName: "CompletePayment" | "SubmitForm";
  stage?: "checkout" | "confirmed" | "delivered";
  status: TiktokLogStatus;
  tiktokEventId?: string | null;
  error?: string | null;
}

/**
 * Audit row for every TikTok Events API outcome. Fire-and-forget by design —
 * an audit write failure must never propagate into order or delivery flows.
 * Separate table from capi_event_log — TikTok outcomes never mix with Meta's.
 */
export async function logTiktokEvent(db: ReturnType<typeof getDb>, entry: TiktokLogEntry): Promise<void> {
  try {
    await db.insert(tiktokEventLog).values({
      id: crypto.randomUUID(),
      orderId: entry.orderId,
      eventName: entry.eventName,
      stage: entry.stage ?? "delivered",
      status: entry.status,
      tiktokEventId: entry.tiktokEventId ?? null,
      error: entry.error ?? null,
      sentAt: new Date().toISOString(),
    });
  } catch (err) {
    console.warn("[tiktok-log] failed to write audit row:", err instanceof Error ? err.message : err);
  }
}
