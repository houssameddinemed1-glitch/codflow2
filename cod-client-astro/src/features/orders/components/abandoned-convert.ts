import type { AbandonedOrder } from "@/features/orders/types";

export const ABANDONED_PREFILL_KEY = "codflow:abandoned-prefill";

export interface AbandonedPrefill {
  id: string;
  customerName: string;
  phone: string;
  wilayaId: number | null;
  communeId: string | null;
  deliveryType: "home" | "stop_desk" | null;
  productId: string | null;
  variantId: string | null;
  price: number | null;
}

export function readAbandonedPrefill(abandonedId: string | null): AbandonedPrefill | null {
  if (!abandonedId) return null;
  try {
    const raw = sessionStorage.getItem(ABANDONED_PREFILL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AbandonedPrefill;
    if (parsed.id !== abandonedId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearAbandonedPrefill() {
  try {
    sessionStorage.removeItem(ABANDONED_PREFILL_KEY);
  } catch {
    /* storage unavailable — nothing to clear */
  }
}

export function startAbandonedConvert(row: AbandonedOrder) {
  const prefill: AbandonedPrefill = {
    id: row.id,
    customerName: row.customerName,
    phone: row.phone,
    wilayaId: row.wilayaId,
    communeId: row.communeId,
    deliveryType: row.deliveryType,
    productId: row.productId,
    variantId: row.variantId,
    price: row.price,
  };
  try {
    sessionStorage.setItem(ABANDONED_PREFILL_KEY, JSON.stringify(prefill));
  } catch {
    /* storage unavailable — the new-order page still opens unprefilled */
  }
  window.location.assign(`/orders/new?abandoned=${encodeURIComponent(row.id)}`);
}
