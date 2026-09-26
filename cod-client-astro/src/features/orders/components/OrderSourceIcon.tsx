import { Globe, LayoutGrid, Music2, Search, Users } from "lucide-react";
import type { OrderBase } from "@/features/orders/types";

export type OrderSource = "facebook" | "tiktok" | "google" | "instagram" | "landing" | "direct";

export function getOrderSource(order: Pick<OrderBase, "fbc" | "fbp" | "ttclid" | "ttp" | "utmSource" | "landingPageId">): OrderSource {
  const utm = order.utmSource?.toLowerCase() ?? "";
  if (utm.includes("facebook") || utm.includes("fb")) return "facebook";
  if (utm.includes("tiktok") || utm.includes("tt")) return "tiktok";
  if (utm.includes("instagram") || utm.includes("ig")) return "instagram";
  if (utm.includes("google") || utm.includes("gclid")) return "google";
  if (order.fbc || order.fbp) return "facebook";
  if (order.ttclid || order.ttp) return "tiktok";
  if (order.landingPageId) return "landing";
  return "direct";
}

export function OrderSourceIcon({ source, size = 14 }: { source: OrderSource; size?: number }) {
  const props = { size, className: "shrink-0" };
  switch (source) {
    case "facebook":
      return <Users {...props} className="shrink-0 text-[#1877F2]" />;
    case "tiktok":
      return <Music2 {...props} className="shrink-0 text-black dark:text-white" />;
    case "instagram":
      return <span className="grid size-3.5 place-items-center rounded-sm bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 text-[8px] font-bold text-white">IG</span>;
    case "google":
      return <Search {...props} className="shrink-0 text-[#4285F4]" />;
    case "landing":
      return <LayoutGrid {...props} className="shrink-0 text-violet-500" />;
    default:
      return <Globe {...props} className="shrink-0 text-muted-foreground" />;
  }
}

export function OrderSourceBadge({ order }: { order: Pick<OrderBase, "fbc" | "fbp" | "ttclid" | "ttp" | "utmSource" | "landingPageId"> }) {
  const source = getOrderSource(order);
  const label: Record<OrderSource, string> = {
    facebook: "Facebook",
    tiktok: "TikTok",
    google: "Google",
    instagram: "Instagram",
    landing: "Landing",
    direct: "Direct",
  };
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs font-medium">
      <OrderSourceIcon source={source} size={12} />
      {label[source]}
    </span>
  );
}
