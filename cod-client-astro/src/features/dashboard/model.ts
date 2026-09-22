import type { OrderStatusStat } from "../../../../cod-shared/queries/analytics";
import type { OrderStatus } from "@/features/orders/types";

export const DASHBOARD_STATUSES: OrderStatus[] = [
  "new",
  "confirmed",
  "unreachable",
  "no_answer_1",
  "no_answer_2",
  "no_answer_3",
  "preparing",
  "ready",
  "assigned",
  "dispatched",
  "out_for_delivery",
  "delivered",
  "returned",
  "cancelled",
];

export function fillStatusStats(stats: OrderStatusStat[]): Array<{ status: OrderStatus; count: number }> {
  const counts = new Map(stats.map((stat) => [stat.status, stat.count]));
  return DASHBOARD_STATUSES.map((status) => ({ status, count: counts.get(status) ?? 0 }));
}
