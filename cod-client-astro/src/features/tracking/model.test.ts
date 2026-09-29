import { describe, expect, it } from "vitest";
import {
  countTrackingGroups,
  filterTrackingOrders,
  trackingGroupOf,
  trackingRowTone,
  EMPTY_TRACKING_FILTERS,
} from "./model";
import type { OrderListItem } from "@/features/orders/types";

function order(overrides: Partial<OrderListItem>): OrderListItem {
  return {
    id: "ord_1",
    orderNumber: "ORD-1",
    customerId: "cus_1",
    customerName: "Ahmed",
    phone: "0555000000",
    wilayaId: 16,
    wilaya: "Alger",
    communeId: null,
    commune: null,
    city: null,
    address: null,
    price: 1000,
    deliveryFee: 400,
    driverFee: 0,
    codAmount: 1400,
    status: "dispatched",
    orderType: "online",
    deliveryMethod: "company",
    deliveryType: "home",
    driverId: null,
    driverName: null,
    companyId: "comp_1",
    assignedAt: null,
    assignedBy: null,
    assignmentNotes: null,
    trackingNumber: "TRK-1",
    trackingUrl: null,
    externalOrderId: null,
    stationCode: null,
    pickupTime: null,
    deliveryTime: null,
    deliveryAttempts: null,
    notes: null,
    internalNote: null,
    photos: null,
    weight: null,
    isFragile: null,
    createdAt: "2026-09-01T10:00:00Z",
    updatedAt: "2026-09-02T10:00:00Z",
    ...overrides,
  };
}

describe("tracking model", () => {
  it("groups shipped statuses", () => {
    expect(trackingGroupOf("dispatched")).toBe("in_transit");
    expect(trackingGroupOf("out_for_delivery")).toBe("in_transit");
    expect(trackingGroupOf("delivered")).toBe("delivered");
    expect(trackingGroupOf("returned")).toBe("returned");
    expect(trackingGroupOf("new")).toBeNull();
    expect(trackingGroupOf("confirmed")).toBeNull();
  });

  it("maps row tones to the requested colors", () => {
    expect(trackingRowTone("delivered")).toBe("delivered");
    expect(trackingRowTone("returned")).toBe("returned");
    expect(trackingRowTone("dispatched")).toBe("transit");
    expect(trackingRowTone("out_for_delivery")).toBe("transit");
    expect(trackingRowTone("cancelled")).toBe("muted");
  });

  it("hides orders without a tracking number", () => {
    const rows = [
      order({ id: "a", status: "dispatched" }),
      order({ id: "b", status: "confirmed", trackingNumber: null }),
    ];
    expect(filterTrackingOrders(rows, EMPTY_TRACKING_FILTERS)).toHaveLength(1);
  });

  it("filters by group, company, and query", () => {
    const rows = [
      order({ id: "a", status: "delivered", trackingNumber: "TRK-A" }),
      order({ id: "b", status: "returned", trackingNumber: "TRK-B" }),
      order({ id: "c", status: "dispatched", trackingNumber: "TRK-C", companyId: "comp_2" }),
    ];
    expect(
      filterTrackingOrders(rows, { ...EMPTY_TRACKING_FILTERS, group: "delivered" }).map((r) => r.id),
    ).toEqual(["a"]);
    expect(
      filterTrackingOrders(rows, { ...EMPTY_TRACKING_FILTERS, company: "comp_2" }).map((r) => r.id),
    ).toEqual(["c"]);
    expect(
      filterTrackingOrders(rows, { ...EMPTY_TRACKING_FILTERS, query: "trk-b" }).map((r) => r.id),
    ).toEqual(["b"]);
  });

  it("counts groups over shipped orders only", () => {
    const rows = [
      order({ id: "a", status: "dispatched" }),
      order({ id: "b", status: "out_for_delivery" }),
      order({ id: "c", status: "delivered" }),
      order({ id: "d", status: "returned" }),
      order({ id: "e", status: "confirmed", trackingNumber: null }),
    ];
    expect(countTrackingGroups(rows)).toEqual({
      total: 4,
      in_transit: 2,
      delivered: 1,
      returned: 1,
    });
  });
});
