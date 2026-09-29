import type { OrderListItem, OrderStatus } from "@/features/orders/types";

export type TrackingGroup = "in_transit" | "delivered" | "returned";

export const TRACKING_STATUSES: OrderStatus[] = [
  "dispatched",
  "out_for_delivery",
  "delivered",
  "returned",
];

export function trackingGroupOf(status: OrderStatus): TrackingGroup | null {
  if (status === "delivered") return "delivered";
  if (status === "returned") return "returned";
  if (status === "dispatched" || status === "out_for_delivery")
    return "in_transit";
  return null;
}

export function isShippedOrder(order: Pick<OrderListItem, "trackingNumber">): boolean {
  return Boolean(order.trackingNumber);
}

export type TrackingRowTone = "transit" | "delivered" | "returned" | "muted";

export function trackingRowTone(status: OrderStatus): TrackingRowTone {
  const group = trackingGroupOf(status);
  if (group === "delivered") return "delivered";
  if (group === "returned") return "returned";
  if (group === "in_transit") return "transit";
  return "muted";
}

export const TRACKING_ROW_CLASS: Record<TrackingRowTone, string> = {
  delivered:
    "border-s-emerald-500 bg-emerald-500/[0.07] hover:bg-emerald-500/[0.12] dark:bg-emerald-400/[0.07] dark:hover:bg-emerald-400/[0.12]",
  returned:
    "border-s-red-500 bg-red-500/[0.07] hover:bg-red-500/[0.12] dark:bg-red-400/[0.07] dark:hover:bg-red-400/[0.12]",
  transit:
    "border-s-amber-500 bg-amber-500/[0.08] hover:bg-amber-500/[0.13] dark:bg-amber-400/[0.08] dark:hover:bg-amber-400/[0.13]",
  muted: "border-s-muted-foreground/25 hover:bg-muted/40",
};

export const TRACKING_DOT_CLASS: Record<TrackingRowTone, string> = {
  delivered: "bg-emerald-500",
  returned: "bg-red-500",
  transit: "bg-amber-500",
  muted: "bg-muted-foreground/40",
};

export interface TrackingFilters {
  query: string;
  group: "all" | TrackingGroup;
  company: string;
  wilaya: string;
}

export const EMPTY_TRACKING_FILTERS: TrackingFilters = {
  query: "",
  group: "all",
  company: "all",
  wilaya: "all",
};

export function filterTrackingOrders(
  orders: OrderListItem[],
  filters: TrackingFilters,
): OrderListItem[] {
  const query = filters.query.trim().toLocaleLowerCase();
  return orders.filter((order) => {
    if (!isShippedOrder(order)) return false;
    if (
      query &&
      !`${order.orderNumber} ${order.customerName} ${order.phone} ${order.trackingNumber ?? ""}`
        .toLocaleLowerCase()
        .includes(query)
    ) {
      return false;
    }
    if (filters.group !== "all" && trackingGroupOf(order.status) !== filters.group)
      return false;
    if (filters.company !== "all" && order.companyId !== filters.company)
      return false;
    if (filters.wilaya !== "all" && order.wilaya !== filters.wilaya)
      return false;
    return true;
  });
}

export function countTrackingGroups(orders: OrderListItem[]): Record<TrackingGroup | "total", number> {
  const shipped = orders.filter(isShippedOrder);
  return {
    total: shipped.length,
    in_transit: shipped.filter((o) => trackingGroupOf(o.status) === "in_transit").length,
    delivered: shipped.filter((o) => trackingGroupOf(o.status) === "delivered").length,
    returned: shipped.filter((o) => trackingGroupOf(o.status) === "returned").length,
  };
}
