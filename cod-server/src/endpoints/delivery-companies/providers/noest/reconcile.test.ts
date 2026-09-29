/**
 * NOEST Reconciliation — Tests.
 *
 * Drives reconcileNoestOrders with a mocked NOEST trackings/info endpoint
 * and a mocked order DB, verifying:
 *   - terminal carrier events advance our order through
 *     updateOrderStatusWebhook with the noest-reconcile source
 *   - transit-only histories leave the order untouched
 *   - unknown carrier strings are skipped + sampled, never guessed
 *   - trackings unknown to the carrier count as notFound
 *   - failed attempts advance dispatched → out_for_delivery and increment
 *     the counter exactly once (no double-count on re-runs)
 *   - the forward-only guard is respected (guard says no → unchanged)
 *
 * The rank guard itself is owned by cod-shared/queries/orders; here it is
 * mocked to model its contract (same approach as reconcile.test.ts).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NoestProvider } from "./adapter";
import { reconcileNoestOrders, reconcileAllNoestCompanies } from "./reconcile";

vi.mock("@/endpoints/orders/queries");
vi.mock("@/endpoints/delivery-companies/queries");

import {
  getAllOrders,
  updateOrderStatusWebhook,
  incrementDeliveryAttempts,
} from "@/endpoints/orders/queries";
import { getDeliveryCompanyByCode } from "@/endpoints/delivery-companies/queries";

const TOKEN = "noest-test-token";
const GUID = "noest-test-guid";
const COMPANY = { id: "comp-noest", code: "noest" };

interface OurOrder {
  id: string;
  status: string;
  companyId: string;
  trackingNumber: string | null;
}

function trackingResponse(entries: Record<string, Array<{ event_key?: string; event?: string }>>) {
  const body: Record<string, unknown> = {};
  for (const [tracking, activity] of Object.entries(entries)) {
    body[tracking] = {
      OrderInfo: { tracking },
      activity: activity.map((a, i) => ({ ...a, date: `2026-09-01 10:0${i}:00` })),
      deliveryAttempts: [],
    };
  }
  return body;
}

const RANK: Record<string, number> = {
  dispatched: 0,
  out_for_delivery: 5,
  delivered: 6,
  returned: 6,
  cancelled: 6,
};

describe("reconcileNoestOrders", () => {
  let ourOrders: OurOrder[];
  let attemptCounts: Record<string, number>;
  let originalFetch: typeof fetch;

  function carrierFetch(payload: Record<string, unknown>) {
    return (async (input: unknown) => {
      const url = String(input);
      if (url === "https://app.noest-dz.com/api/public/get/trackings/info") {
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected NOEST call: ${url}`);
    }) as unknown as typeof fetch;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = global.fetch;
    attemptCounts = {};

    ourOrders = [
      { id: "ord-1", status: "dispatched", companyId: COMPANY.id, trackingNumber: "TRK-DELIVERED" },
      { id: "ord-2", status: "out_for_delivery", companyId: COMPANY.id, trackingNumber: "TRK-TRANSIT" },
      { id: "ord-3", status: "dispatched", companyId: COMPANY.id, trackingNumber: "TRK-MYSTERY" },
      { id: "ord-4", status: "dispatched", companyId: COMPANY.id, trackingNumber: "TRK-GHOST" },
      { id: "ord-5", status: "dispatched", companyId: COMPANY.id, trackingNumber: "TRK-ATTEMPT" },
      { id: "ord-6", status: "dispatched", companyId: "comp-other", trackingNumber: "TRK-FOREIGN" },
      { id: "ord-7", status: "dispatched", companyId: COMPANY.id, trackingNumber: null },
    ];

    vi.mocked(getAllOrders).mockImplementation(
      (async (_db: unknown, filters?: { status?: string }) =>
        ourOrders.filter((o) => !filters?.status || o.status === filters.status)) as any,
    );
    vi.mocked(updateOrderStatusWebhook).mockImplementation(
      (async (_db: unknown, orderId: string, newStatus: string) => {
        const order = ourOrders.find((o) => o.id === orderId)!;
        // Model the forward-only rank guard.
        if ((RANK[newStatus] ?? 0) <= (RANK[order.status] ?? 0)) return { updated: false };
        order.status = newStatus;
        return { updated: true };
      }) as any,
    );
    vi.mocked(incrementDeliveryAttempts).mockImplementation(
      (async (_db: unknown, orderId: string) => {
        attemptCounts[orderId] = (attemptCounts[orderId] ?? 0) + 1;
      }) as any,
    );

    global.fetch = carrierFetch(
      trackingResponse({
        "TRK-DELIVERED": [
          { event_key: "upload", event: "Uploadé sur le système" },
          { event_key: "livre", event: "Livré" },
        ],
        "TRK-TRANSIT": [
          { event_key: "upload", event: "Uploadé sur le système" },
          { event_key: "transit", event: "En transit" },
        ],
        "TRK-MYSTERY": [{ event_key: "weird_xyz", event: "Statut bizarre" }],
        "TRK-ATTEMPT": [{ event_key: "tentative", event: "Tentative de livraison" }],
        "TRK-FOREIGN": [{ event_key: "livre", event: "Livré" }],
      }),
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("advances delivered, skips transit/unknown/ghost, counts attempts once", async () => {
    const provider = new NoestProvider(TOKEN, GUID);
    const summary = await reconcileNoestOrders({} as any, provider, COMPANY);

    expect(summary.ordersSeen).toBe(5); // ord-6 (other company) + ord-7 (no tracking) excluded
    expect(summary.updated).toBe(2); // TRK-DELIVERED + TRK-ATTEMPT
    expect(summary.notFound).toBe(1); // TRK-GHOST
    expect(summary.skippedUnmapped).toBe(1); // TRK-MYSTERY
    expect(summary.unmappedSamples).toContain("weird_xyz");

    expect(vi.mocked(updateOrderStatusWebhook)).toHaveBeenCalledWith(
      expect.anything(),
      "ord-1",
      "delivered",
      "noest-reconcile:noest",
    );
    expect(vi.mocked(updateOrderStatusWebhook)).toHaveBeenCalledWith(
      expect.anything(),
      "ord-5",
      "out_for_delivery",
      "noest-reconcile:noest",
    );
    // Foreign-company order never touched even though the carrier says delivered.
    expect(vi.mocked(updateOrderStatusWebhook)).not.toHaveBeenCalledWith(
      expect.anything(),
      "ord-6",
      expect.anything(),
      expect.anything(),
    );
    expect(attemptCounts).toEqual({ "ord-5": 1 });
    expect(ourOrders.find((o) => o.id === "ord-1")!.status).toBe("delivered");
  });

  it("falls back to single pulls when the batched call comes back empty", async () => {
    const full = trackingResponse({
      "TRK-DELIVERED": [
        { event_key: "upload", event: "Uploadé sur le système" },
        { event_key: "Delivered", event: "Livré" },
      ],
      "TRK-TRANSIT": [
        { event_key: "upload", event: "Uploadé sur le système" },
        { event_key: "transit", event: "En transit" },
      ],
      "TRK-MYSTERY": [{ event_key: "weird_xyz", event: "Statut bizarre" }],
      "TRK-ATTEMPT": [{ event_key: "tentative", event: "Tentative de livraison" }],
    });
    global.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
      const trackings = (JSON.parse(String((init as { body: string }).body)) as { trackings: string[] }).trackings;
      if (trackings.length > 1) return new Response(JSON.stringify({}), { status: 200 });
      const body: Record<string, unknown> = {};
      for (const t of trackings) if (full[t]) body[t] = full[t];
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;

    const provider = new NoestProvider(TOKEN, GUID);
    const summary = await reconcileNoestOrders({} as any, provider, COMPANY);

    expect(summary.updated).toBe(2);
    expect(ourOrders.find((o) => o.id === "ord-1")!.status).toBe("delivered");
  });

  it("never double-counts attempts on re-runs", async () => {
    const provider = new NoestProvider(TOKEN, GUID);
    await reconcileNoestOrders({} as any, provider, COMPANY);
    const second = await reconcileNoestOrders({} as any, provider, COMPANY);

    expect(attemptCounts).toEqual({ "ord-5": 1 });
    // Second run: ord-5 already out_for_delivery with no new decisive info.
    expect(second.updated).toBe(0);
  });

  it("respects the forward-only guard (guard says no → unchanged)", async () => {
    vi.mocked(updateOrderStatusWebhook).mockResolvedValue({ updated: false });
    const provider = new NoestProvider(TOKEN, GUID);
    const summary = await reconcileNoestOrders({} as any, provider, COMPANY);

    expect(summary.updated).toBe(0);
    expect(summary.unchanged).toBeGreaterThan(0);
  });
});

describe("reconcileAllNoestCompanies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAllOrders).mockResolvedValue([]);
  });

  it("skips cleanly when NOEST is absent or not connected", async () => {
    vi.mocked(getDeliveryCompanyByCode).mockResolvedValue(null);
    await expect(reconcileAllNoestCompanies({} as any)).resolves.toMatchObject({
      ran: false,
      reason: "no-noest-company",
    });

    vi.mocked(getDeliveryCompanyByCode).mockResolvedValue({ id: "c", code: "noest", apiToken: null } as any);
    await expect(reconcileAllNoestCompanies({} as any)).resolves.toMatchObject({
      ran: false,
      reason: "not-connected",
    });
  });

  it("runs the sync for the connected NOEST company", async () => {
    vi.mocked(getDeliveryCompanyByCode).mockResolvedValue({
      id: COMPANY.id,
      code: "noest",
      apiToken: TOKEN,
      apiUserGuid: GUID,
      apiEndpoint: null,
    } as any);

    const result = await reconcileAllNoestCompanies({} as any);
    expect(result.ran).toBe(true);
    expect(result.companyId).toBe(COMPANY.id);
    expect(result.summary).toMatchObject({ ordersSeen: 0, updated: 0 });
  });
});
