import { z } from "zod";
import { getDb } from "@/db";
import { orders, communes, orderProducts, stores, capiEventLog, landingPages } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { getPixelConfig } from "../../../cod-shared/queries/pixel-config";
import { sendCapiEvent, type CapiResult } from "@/lib/capi";
import {
  resolveCapiDispatch,
  resolveConversionForStage,
} from "./capi-helpers";
import { conversionSourceUrl } from "./conversion-model";
import { logCapiEvent } from "@/lib/capi-log";

const SEVEN_DAYS_SECONDS = 7 * 24 * 3600;

export const CodCapiParamsSchema = z.object({
  orderId: z.string().min(1, "orderId is required"),
  eventName: z.enum(["Lead", "Purchase"]),
  stage: z.enum(["checkout", "confirmed", "delivered"]).default("delivered"),
  triggeredAt: z.number().int().positive("triggeredAt must be a positive integer"),
  triggerStatus: z.string().min(1, "triggerStatus is required"),
  eventSourceUrl: z.string().url().optional(),
});

export type CodCapiParams = z.infer<typeof CodCapiParamsSchema>;

function splitName(customerName: string): { firstName?: string; lastName?: string } {
  const parts = customerName.trim().split(/\s+/);
  return {
    firstName: parts[0] || undefined,
    lastName: parts.length > 1 ? parts[parts.length - 1] : undefined,
  };
}

export type CapiRunResult =
  | { skipped: true; reason: string }
  | { success: boolean; metaEventId: string | null | undefined };

/**
 * QStash-consumable CAPI send. Same steps as the old durable workflow:
 * validate → fetch → gate → age check → atomic claim → send → log.
 * Throws on send failure so QStash retries (5x); every early exit returns
 * skipped (no retry). The claim row + in-flight guard keep redeliveries safe.
 */
export async function runCapiEvent(raw: unknown): Promise<CapiRunResult> {
  const parsed = CodCapiParamsSchema.safeParse(raw);
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
      customerEmail: orders.customerEmail,
      landingPageId: orders.landingPageId,
      wilayaId: orders.wilayaId,
      communeId: orders.communeId,
      city: orders.city,
      price: orders.price,
      deliveryFee: orders.deliveryFee,
      fbc: orders.fbc,
      fbp: orders.fbp,
      ipAddress: orders.ipAddress,
      userAgent: orders.userAgent,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .then((rows) => rows[0] ?? null);

  if (!order) return { skipped: true, reason: "order_not_found" };

  const communeRow = order.communeId
    ? await db
        .select({ name: communes.name, postalCode: communes.postalCode })
        .from(communes)
        .where(eq(communes.id, order.communeId))
        .then((rows) => rows[0] ?? null)
    : null;

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

  const pixelConfig = await getPixelConfig(db, storeRow.id);

  const decision = resolveConversionForStage(pixelConfig?.conversionEvent, stage);
  const shouldFire = decision.shouldFire && decision.eventName === eventName;
  if (!shouldFire) {
    return { skipped: true, reason: decision.reason ?? "stage_mismatch" };
  }

  const dispatch = resolveCapiDispatch(pixelConfig, eventName, stage);
  if (!dispatch.send) {
    if (dispatch.reason === "no-access-token") {
      await logCapiEvent(db, {
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
    await logCapiEvent(db, {
      orderId,
      eventName,
      stage,
      status: "skipped",
      error: `event_time expired: order ${orderId} is ${Math.round(ageSeconds / 3600)}h old — outside Meta 7-day window`,
    });
    return { skipped: true, reason: "event_time_expired" };
  }

  const now = new Date().toISOString();
  const claimId = `claim-${orderId}-${stage}-${eventName}`;
  const claimed = await db
    .insert(capiEventLog)
    .values({
      id: claimId,
      orderId,
      eventName,
      stage,
      status: "claimed",
      sentAt: now,
    })
    .onConflictDoNothing({
      target: [capiEventLog.orderId, capiEventLog.stage, capiEventLog.eventName],
    })
    .returning({ id: capiEventLog.id });

  if (claimed.length === 0) {
    const existing = await db
      .select({ status: capiEventLog.status, sentAt: capiEventLog.sentAt })
      .from(capiEventLog)
      .where(
        and(
          eq(capiEventLog.orderId, orderId),
          eq(capiEventLog.stage, stage),
          eq(capiEventLog.eventName, eventName),
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
    eventSourceUrl ??
    conversionSourceUrl(
      storeRow.domain,
      order.landingPageId
        ? (
            await db
              .select({ slug: landingPages.slug })
              .from(landingPages)
              .where(eq(landingPages.id, order.landingPageId))
              .then((rows) => rows[0] ?? null)
          )?.slug ?? null
        : null,
    );

  const { firstName, lastName } = splitName(order.customerName);
  let capiResult: CapiResult;

  try {
    capiResult = await sendCapiEvent(pixelConfig!.pixelId, pixelConfig!.accessToken, {
      eventName,
      eventId: orderId,
      eventTime: triggeredAt,
      eventSourceUrl: finalEventSourceUrl,
      userData: {
        phone: order.phone,
        email: order.customerEmail,
        firstName,
        lastName,
        externalId: order.customerId,
        city: communeRow?.name ?? null,
        postalCode: communeRow?.postalCode,
        fbc: order.fbc,
        fbp: order.fbp,
        clientIpAddress: order.ipAddress,
        clientUserAgent: order.userAgent,
      },
      value: eventName === "Purchase" ? order.price + order.deliveryFee : undefined,
      currency: "DZD",
      contentIds: [...new Set(productRows.map((r) => r.productId))],
      testEventCode: dispatch.testEventCode,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await db.execute(
      sql`UPDATE capi_event_log
          SET status = 'failed', error = ${errorMsg}, sent_at = ${now}
          WHERE order_id = ${orderId} AND stage = ${stage} AND event_name = ${eventName}`,
    );
    throw err;
  }

  const status = capiResult.success ? "sent" : "failed";
  await db.execute(
    sql`UPDATE capi_event_log
        SET status = ${status}, meta_event_id = ${capiResult.fbtrace_id ?? null}, error = ${capiResult.error ?? null}, sent_at = ${now}
        WHERE order_id = ${orderId} AND stage = ${stage} AND event_name = ${eventName}`,
  );

  return { success: capiResult.success, metaEventId: capiResult.fbtrace_id };
}
