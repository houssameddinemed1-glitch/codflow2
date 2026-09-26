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

export function OrderSourceIcon({ source, size = 16 }: { source: OrderSource; size?: number }) {
  const iconSize = Math.max(12, size - 6);
  const wrap = "grid place-items-center shrink-0 rounded-full text-white shadow-sm";
  const box = `size-[${size}px]`.replace("[", "").replace("]", "");
  // Use fixed sizes for Tailwind purge safety
  const sizeClass = size >= 20 ? "size-6" : size >= 18 ? "size-[18px]" : "size-5";
  switch (source) {
    case "facebook":
      return <span className={`${sizeClass} ${wrap} bg-[#1877F2]`}><Users size={iconSize} className="text-white" /></span>;
    case "tiktok":
      return <span className={`${sizeClass} ${wrap} bg-black`}><Music2 size={iconSize} className="text-white" /></span>;
    case "instagram":
      return <span className={`${sizeClass} ${wrap} bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 text-[9px] font-black`}>IG</span>;
    case "google":
      return <span className={`${sizeClass} ${wrap} bg-white border border-border`}><Search size={iconSize} className="text-[#4285F4]" /></span>;
    case "landing":
      return <span className={`${sizeClass} ${wrap} bg-violet-500`}><LayoutGrid size={iconSize} className="text-white" /></span>;
    default:
      return <span className={`${sizeClass} ${wrap} bg-muted border border-border`}><Globe size={iconSize} className="text-muted-foreground" /></span>;
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
