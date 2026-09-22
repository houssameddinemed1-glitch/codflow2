import { z } from "zod";
import { getDb } from "@/db";
import { orders, orderProducts, stores, tiktokEventLog } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { getTiktokConfig } from "../../../cod-shared/queries/tiktok-config";
import { sendTiktokEvent, type TiktokResult } from "@/lib/tiktok-events";
import {
  resolveTiktokForStage,
  resolveTiktokDispatch,
} from "./tiktok-conversion-model";
import { logTiktokEvent } from "@/lib/tiktok-log";

const SEVEN_DAYS_SECONDS = 7 * 24 * 3600;

export const CodTiktokParamsSchema = z.object({
  orderId: z.string().min(1, "orderId is required"),
  eventName: z.enum(["CompletePayment", "SubmitForm"]),
  stage: z.enum(["checkout", "confirmed", "delivered"]).default("delivered"),
  triggeredAt: z.number().int().positive("triggeredAt must be a positive integer"),
  triggerStatus: z.string().min(1, "triggerStatus is required"),
  eventSourceUrl: z.string().url().optional(),
});

export type CodTiktokParams = z.infer<typeof CodTiktokParamsSchema>;

export type TiktokRunResult =
  | { skipped: true; reason: string }
  | { success: boolean };

/**
 * QStash-consumable TikTok send. Same steps as the old durable workflow:
 * validate → fetch → gate → age check → atomic claim → send → log.
 * Throws on send failure so QStash retries (5x); every early exit returns
 * skipped (no retry). The claim row + in-flight guard keep redeliveries safe.
 */
export async function runTiktokEvent(raw: unknown): Promise<TiktokRunResult> {
  const parsed = CodTiktokParamsSchema.safeParse(raw);
  if (!parsed.success) {
    const errorMsg = parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
    return { skipped: true, reason: `invalid_payload: ${errorMsg}` };
  }

  const { orderId, eventName, stage, triggeredAt, eventSourceUrl } = parsed.data;
  const db = getDb();

  const order = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      customerId: orders.customerId,
      customerName: orders.customerName,
      phone: orders.phone,
      wilayaId: orders.wilayaId,
      communeId: orders.communeId,
      price: orders.price,
      deliveryFee: orders.deliveryFee,
      ipAddress: orders.ipAddress,
      userAgent: orders.userAgent,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .then((rows) => rows[0] ?? null);

  if (!order) return { skipped: true, reason: "order_not_found" };

  const storeRow = await db
    .select({ id: stores.id, domain: stores.domain })
    .from(stores)
    .limit(1)
    .then((rows) => rows[0] ?? null);
  if (!storeRow) return { skipped: true, reason: "no_store" };

  const productRows = await db
    .select({ productId: orderProducts.productId })
    .from(orderProducts)
    .where(eq(orderProducts.orderId, orderId));

  const tiktokConfig = await getTiktokConfig(db, storeRow.id);

  const decision = resolveTiktokForStage(tiktokConfig?.conversionEvent, stage);
  const shouldFire = decision.shouldFire && decision.eventName === eventName;
  if (!shouldFire) {
    return { skipped: true, reason: decision.reason ?? "stage_mismatch" };
  }

  const dispatch = resolveTiktokDispatch(tiktokConfig, eventName, stage);
  if (!dispatch.send) {
    if (dispatch.reason === "no-access-token") {
      await logTiktokEvent(db, {
        orderId,
        eventName,
        stage,
        status: "skipped",
        error: dispatch.message,
      });
    }
    return { skipped: true, reason: dispatch.reason };
  }

  const ageSeconds = Math.floor(Date.now() / 1000) - triggeredAt;
  if (ageSeconds >= SEVEN_DAYS_SECONDS) {
    await logTiktokEvent(db, {
      orderId,
      eventName,
      stage,
      status: "skipped",
      error: `event_time expired: order ${orderId} is ${Math.round(ageSeconds / 3600)}h old — outside the 7-day window`,
    });
    return { skipped: true, reason: "event_time_expired" };
  }

  const now = new Date().toISOString();
  const claimId = `claim-${orderId}-${stage}-${eventName}`;
  const claimed = await db
    .insert(tiktokEventLog)
    .values({
      id: claimId,
      orderId,
      eventName,
      stage,
      status: "claimed",
      sentAt: now,
    })
    .onConflictDoNothing({
      target: [tiktokEventLog.orderId, tiktokEventLog.stage, tiktokEventLog.eventName],
    })
    .returning({ id: tiktokEventLog.id });

  if (claimed.length === 0) {
    const existing = await db
      .select({ status: tiktokEventLog.status, sentAt: tiktokEventLog.sentAt })
      .from(tiktokEventLog)
      .where(
        and(
          eq(tiktokEventLog.orderId, orderId),
          eq(tiktokEventLog.stage, stage),
          eq(tiktokEventLog.eventName, eventName),
        ),
      )
      .then((rows) => rows[0] ?? null);
    if (existing) {
      if (existing.status === "sent") {
        return { skipped: true, reason: "already_sent" };
      }
      if (existing.status === "claimed") {
        const elapsed = Date.now() - new Date(existing.sentAt).getTime();
        if (elapsed < 10 * 60 * 1000) {
          return { skipped: true, reason: "already_in_flight" };
        }
      }
    }
  }

  const finalEventSourceUrl =
    eventSourceUrl ?? (storeRow.domain ? `https://${storeRow.domain}/thank-you` : undefined);

  let tiktokResult: TiktokResult;

  try {
    tiktokResult = await sendTiktokEvent(tiktokConfig!.pixelId, tiktokConfig!.accessToken, {
      eventName,
      eventId: orderId,
      eventTime: triggeredAt,
      eventSourceUrl: finalEventSourceUrl,
      userData: {
        phone: order.phone,
        externalId: order.customerId,
        clientIpAddress: order.ipAddress,
        clientUserAgent: order.userAgent,
      },
      value: eventName === "CompletePayment" ? order.price + order.deliveryFee : undefined,
      currency: "DZD",
      contentIds: [...new Set(productRows.map((r) => r.productId))],
      testEventCode: dispatch.testEventCode,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await db.execute(
      sql`UPDATE tiktok_event_log
          SET status = 'failed', error = ${errorMsg}, sent_at = ${now}
          WHERE order_id = ${orderId} AND stage = ${stage} AND event_name = ${eventName}`,
    );
    throw err;
  }

  const status = tiktokResult.success ? "sent" : "failed";
  const error = tiktokResult.error ?? null;
  await db.execute(
    sql`UPDATE tiktok_event_log
        SET status = ${status}, error = ${error}, sent_at = ${now}
        WHERE order_id = ${orderId} AND stage = ${stage} AND event_name = ${eventName}`,
  );

  return { success: tiktokResult.success };
}
