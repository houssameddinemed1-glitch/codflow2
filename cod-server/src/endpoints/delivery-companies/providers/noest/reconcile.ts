/**
 * NOEST Order Reconciliation
 *
 * Pull-based status sync for NOEST — the carrier offers no status webhooks
 * (capabilities.supportsWebhooks is false) and CodFlow has no inbound
 * receiver for it, so polling is the ONLY freshness source.
 *
 * How it works: list OUR open company orders (dispatched / out_for_delivery
 * with a tracking number), pull their tracking histories in ONE batched
 * NOEST call (POST /api/public/get/trackings/info accepts an array), take
 * each parcel's latest DECISIVE event (newest → oldest, skipping transit /
 * payment / unknown noise), and apply it through updateOrderStatusWebhook —
 * the SAME forward-only rank guard webhooks use — so an order can never
 * move backwards and terminal statuses are respected.
 *
 * Attempt counting is conservative: the counter increments only when the
 * run actually advances the order (dispatched → out_for_delivery on a
 * failed attempt). Re-runs over an already out_for_delivery order never
 * double-count.
 *
 * Unknown carrier strings are skipped and sampled in the result — never
 * guessed into a transition (webhook contract rule).
 */

import type { AppDb } from "@/db";
import { getAllOrders, updateOrderStatusWebhook, incrementDeliveryAttempts } from "@/endpoints/orders/queries";
import { getDeliveryCompanyByCode } from "@/endpoints/delivery-companies/queries";
import { getProvider } from "@/endpoints/delivery-companies/providers/registry";
import { NoestProvider } from "./adapter";
import { mapNoestEvent } from "./status-mapping";
import type { TrackingEvent } from "../types";

export interface NoestReconcileSummary {
  pagesFetched: number;
  ordersSeen: number;
  updated: number;
  unchanged: number;
  notFound: number;
  skippedUnmapped: number;
  unmappedSamples: string[];
  morePagesRemain: boolean;
}

export const DEFAULT_MAX_ORDERS = 100;
/** Trackings per NOEST bulk call (same order of magnitude as their bulk limits). */
const TRACKINGS_PER_CALL = 50;

const OPEN_STATUSES = ["dispatched", "out_for_delivery"] as const;

function emptySummary(): NoestReconcileSummary {
  return {
    pagesFetched: 0,
    ordersSeen: 0,
    updated: 0,
    unchanged: 0,
    notFound: 0,
    skippedUnmapped: 0,
    unmappedSamples: [],
    morePagesRemain: false,
  };
}

function sampleUnmapped(summary: NoestReconcileSummary, raw: string) {
  if (summary.unmappedSamples.length < 5 && !summary.unmappedSamples.includes(raw)) {
    summary.unmappedSamples.push(raw);
  }
}

export async function reconcileNoestOrders(
  db: AppDb,
  provider: NoestProvider,
  company: { id: string; code: string },
  options?: { maxOrders?: number },
): Promise<NoestReconcileSummary> {
  const maxOrders = options?.maxOrders ?? DEFAULT_MAX_ORDERS;
  const source = `noest-reconcile:${company.code}`;
  const summary = emptySummary();

  // ── 1. Our open orders for this company ──
  const open: Array<{ id: string; status: string; trackingNumber: string }> = [];
  for (const status of OPEN_STATUSES) {
    const rows = await getAllOrders(db, { status, limit: maxOrders });
    for (const row of rows as Array<{ id: string; status: string; companyId: string | null; trackingNumber: string | null }>) {
      if (row.companyId === company.id && row.trackingNumber) {
        open.push({ id: row.id, status: row.status, trackingNumber: row.trackingNumber });
      }
    }
    if (open.length >= maxOrders) break;
  }
  const targets = open.slice(0, maxOrders);
  summary.morePagesRemain = open.length > targets.length;

  // ── 2. Batched tracking pull (one NOEST call per 50 trackings) ──
  for (let i = 0; i < targets.length; i += TRACKINGS_PER_CALL) {
    const chunk = targets.slice(i, i + TRACKINGS_PER_CALL);
    summary.pagesFetched += 1;
    const histories = await provider.getTrackingInfoBulk(chunk.map((t) => t.trackingNumber));

    for (const target of chunk) {
      if (!histories[target.trackingNumber]) {
        try {
          histories[target.trackingNumber] = await provider.getTrackingInfo(target.trackingNumber);
        } catch {
          // Carrier genuinely doesn't know this tracking — counted below.
        }
      }
    }

    for (const target of chunk) {
      summary.ordersSeen += 1;
      const events: TrackingEvent[] | undefined = histories[target.trackingNumber];
      if (!events) {
        // Carrier doesn't know this tracking (draft, or created elsewhere).
        summary.notFound += 1;
        continue;
      }

      // ── 3. Latest decisive event, newest first ──
      let decisive: { status: "delivered" | "returned" | "cancelled" | "out_for_delivery"; incrementAttempts: boolean } | null = null;
      let sawUnknown = false;
      for (let e = events.length - 1; e >= 0; e--) {
        const ev = events[e];
        const mapped = mapNoestEvent(ev.activity, (ev as { description?: string }).description);
        if (mapped.status === null && !mapped.incrementAttempts) {
          // Known transit / payment noise → look further back. Truly unknown
          // strings are flagged so the mapping table can grow from real data.
          if (!mapped.noop && ev.activity) {
            sawUnknown = true;
            sampleUnmapped(summary, String(ev.activity));
          }
          continue;
        }
        decisive = { status: mapped.status!, incrementAttempts: mapped.incrementAttempts };
        break;
      }

      if (!decisive) {
        if (sawUnknown) summary.skippedUnmapped += 1;
        summary.unchanged += 1;
        continue;
      }

      if (target.status === decisive.status && !decisive.incrementAttempts) {
        summary.unchanged += 1;
        continue;
      }

      const { updated } = await updateOrderStatusWebhook(db, target.id, decisive.status, source);
      if (updated) {
        summary.updated += 1;
        // Count the attempt exactly once — on the run that advances the order.
        if (decisive.incrementAttempts) await incrementDeliveryAttempts(db, target.id);
      } else {
        summary.unchanged += 1;
      }
    }
  }

  return summary;
}

export async function reconcileAllNoestCompanies(
  db: AppDb,
): Promise<{ ran: boolean; companyId?: string; summary?: NoestReconcileSummary; reason?: string }> {
  const company = await getDeliveryCompanyByCode(db, "noest");
  if (!company) return { ran: false, reason: "no-noest-company" };
  if (!company.apiToken) return { ran: false, reason: "not-connected" };

  let provider;
  try {
    provider = getProvider(company);
  } catch {
    return { ran: false, reason: "provider-unavailable" };
  }
  if (!(provider instanceof NoestProvider)) return { ran: false, reason: "provider-mismatch" };

  const summary = await reconcileNoestOrders(db, provider, { id: company.id, code: company.code });
  console.info(
    `[reconcile] company=${company.id} code=noest seen=${summary.ordersSeen} updated=${summary.updated} unmapped=${summary.skippedUnmapped}`,
  );
  return { ran: true, companyId: company.id, summary };
}
