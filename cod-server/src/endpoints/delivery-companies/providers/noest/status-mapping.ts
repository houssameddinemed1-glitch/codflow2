/**
 * NOEST Status Mapper
 *
 * NOEST emits its own tracking vocabulary (machine `event_key` slugs plus
 * human-readable French `event` labels) and mixes payment/finance events
 * into the activity feed — those are NOT parcel movement and must never
 * move an order.
 *
 * Semantics (same discipline as the Yalidine mapper):
 *   - Only DEFINITIVE outcomes map: delivered / returned / cancelled,
 *     plus out_for_delivery and failed delivery attempts (counter only).
 *   - Transit, pickup, hub, draft/validation, waiting, return-transit and
 *     payment/finance strings are deliberate no-ops: they must NEVER move
 *     an order backward (a dispatched order stays dispatched until the
 *     carrier reports it out for delivery or terminal).
 *   - A string in NEITHER table → unknown: the caller logs it as unmapped
 *     (sampled in the reconcile summary so the table can grow from real
 *     data) and leaves the order untouched — never guessed.
 *
 * Matching is accent- and case-insensitive, so "Livré", "LIVRE" and the
 * "livre" slug all hit the same row.
 */

export interface NoestStatusMapping {
  /** Target order status — null = no status change (transit/no-op or unknown). */
  status: "delivered" | "returned" | "cancelled" | "out_for_delivery" | null;
  /** True for failed attempts: increment deliveryAttempts, keep/ensure out_for_delivery. */
  incrementAttempts: boolean;
  /** True = KNOWN non-movement string (deliberate no-op).
   *  False + status null = unknown string → caller logs 'unmapped'. */
  noop: boolean;
}

const MAPPING_DELIVERED: NoestStatusMapping = { status: "delivered", incrementAttempts: false, noop: false };
const MAPPING_CANCELLED: NoestStatusMapping = { status: "cancelled", incrementAttempts: false, noop: false };
const MAPPING_RETURNED: NoestStatusMapping = { status: "returned", incrementAttempts: false, noop: false };
const MAPPING_OUT: NoestStatusMapping = { status: "out_for_delivery", incrementAttempts: false, noop: false };
const MAPPING_ATTEMPTS: NoestStatusMapping = { status: "out_for_delivery", incrementAttempts: true, noop: false };
const MAPPING_NOOP: NoestStatusMapping = { status: null, incrementAttempts: false, noop: true };
const MAPPING_UNKNOWN: NoestStatusMapping = { status: null, incrementAttempts: false, noop: false };

/**
 * All keys are PRE-NORMALIZED (lowercase, accents stripped, "_" and "-"
 * folded to spaces, whitespace collapsed). mapNoestEvent normalizes input
 * the same way before lookup.
 */
const NOEST_EVENT_MAP: Record<string, NoestStatusMapping> = {
  // ── Terminal: delivered ──
  "livre": MAPPING_DELIVERED,
  "delivered": MAPPING_DELIVERED,
  "colis livre": MAPPING_DELIVERED,
  "livraison effectuee": MAPPING_DELIVERED,
  "livraison reussie": MAPPING_DELIVERED,
  "livre non encaisse": MAPPING_DELIVERED, // delivered to the customer; COD collection is finance, not movement

  // ── Terminal: cancelled ──
  "annule": MAPPING_CANCELLED,
  "annulee": MAPPING_CANCELLED,
  "cancelled": MAPPING_CANCELLED,
  "canceled": MAPPING_CANCELLED,
  "colis annule": MAPPING_CANCELLED,
  "commande annulee": MAPPING_CANCELLED,

  // ── Terminal: returned (definitive outcomes only — return TRANSIT stays noop) ──
  "retourne": MAPPING_RETURNED,
  "returned": MAPPING_RETURNED,
  "retourne au vendeur": MAPPING_RETURNED,
  "retour vendeur": MAPPING_RETURNED,
  "retour definitif": MAPPING_RETURNED,
  "colis retourne": MAPPING_RETURNED,
  "retour non recupere": MAPPING_RETURNED,

  // ── Out for delivery ──
  "sorti en livraison": MAPPING_OUT,
  "en cours de livraison": MAPPING_OUT,
  "avec livreur": MAPPING_OUT,
  "chez livreur": MAPPING_OUT,
  "out for delivery": MAPPING_OUT,

  // ── Failed attempt (counter; parcel stays out for delivery) ──
  "tentative de livraison": MAPPING_ATTEMPTS,
  "tentative echouee": MAPPING_ATTEMPTS,
  "tentative": MAPPING_ATTEMPTS,
  "delivery attempted": MAPPING_ATTEMPTS,
  "delivery attempt": MAPPING_ATTEMPTS,
  "failed attempt": MAPPING_ATTEMPTS,
  "client ne repond pas": MAPPING_ATTEMPTS,
  "pas de reponse": MAPPING_ATTEMPTS,
  "injoignable": MAPPING_ATTEMPTS,

  // ── Draft / created / validated — deliberate no-ops ──
  "upload": MAPPING_NOOP,
  "uploade sur le systeme": MAPPING_NOOP,
  "enregistre": MAPPING_NOOP,
  "cree": MAPPING_NOOP,
  "created": MAPPING_NOOP,
  "customer validation": MAPPING_NOOP,
  "valide": MAPPING_NOOP,
  "validation": MAPPING_NOOP,
  "confirme": MAPPING_NOOP,
  "prete": MAPPING_NOOP,
  "pret pour ramassage": MAPPING_NOOP,

  // ── Remarks / notes — not movement ──
  "mise a jour": MAPPING_NOOP,
  "remarque": MAPPING_NOOP,
  "note": MAPPING_NOOP,
  "commentaire": MAPPING_NOOP,

  // ── Pickup / transit / hub — deliberate no-ops (never regress dispatched) ──
  "ramasse": MAPPING_NOOP,
  "ramassage": MAPPING_NOOP,
  "pickup": MAPPING_NOOP,
  "picked up": MAPPING_NOOP,
  "collecte": MAPPING_NOOP,
  "en transit": MAPPING_NOOP,
  "transit": MAPPING_NOOP,
  "transfert": MAPPING_NOOP,
  "expedie": MAPPING_NOOP,
  "en route": MAPPING_NOOP,
  "vers wilaya": MAPPING_NOOP,
  "centre": MAPPING_NOOP,
  "hub": MAPPING_NOOP,
  "arrive au centre": MAPPING_NOOP,
  "recu au centre": MAPPING_NOOP,
  "au centre de tri": MAPPING_NOOP,
  "agence": MAPPING_NOOP,
  "reception": MAPPING_NOOP,

  // ── Waiting / postponed — still in progress, no movement ──
  "en attente": MAPPING_NOOP,
  "en alerte": MAPPING_NOOP,
  "reporte": MAPPING_NOOP,
  "replanifie": MAPPING_NOOP,
  "bloque": MAPPING_NOOP,

  // ── Return transit (NOT definitive — can still resolve) — no-op ──
  "retour vers centre": MAPPING_NOOP,
  "retour au centre": MAPPING_NOOP,
  "retourne au centre": MAPPING_NOOP,
  "retour en cours": MAPPING_NOOP,
  "retour en transit": MAPPING_NOOP,
  "en cours de retour": MAPPING_NOOP,
  "retour a retirer": MAPPING_NOOP,

  // ── Payment / finance events — NOT parcel movement, never a status ──
  "paiement": MAPPING_NOOP,
  "paye": MAPPING_NOOP,
  "encaisse": MAPPING_NOOP,
  "encaissement": MAPPING_NOOP,
  "non encaisse": MAPPING_NOOP,
  "facture": MAPPING_NOOP,
  "versement": MAPPING_NOOP,
  "creance": MAPPING_NOOP,
  "remboursement": MAPPING_NOOP,
  "solde": MAPPING_NOOP,
  "payment": MAPPING_NOOP,
  "paid": MAPPING_NOOP,
  "invoiced": MAPPING_NOOP,
  "finance": MAPPING_NOOP,
};

/** Normalize a raw carrier string the same way the table keys are written. */
export function normalizeNoestEventString(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

/**
 * Map one NOEST tracking event to our order status.
 *
 * `activity` is the machine `event_key` when NOEST sends one (the adapter
 * stores event_key ?? event there); `description` is the human French label.
 * The key is tried first — when NOEST sends a known slug it wins; otherwise
 * the French label is matched. A slug NOT in the table falls through to the
 * label instead of reporting unknown (slugs are the less stable side).
 *
 * Unknown on both sides → { status: null, noop: false }: caller samples it
 * as 'unmapped' and changes nothing.
 */
export function mapNoestEvent(
  activity: string | null | undefined,
  description?: string | null,
): NoestStatusMapping {
  const keyHit = NOEST_EVENT_MAP[normalizeNoestEventString(activity)];
  if (keyHit && (keyHit.status !== null || keyHit.incrementAttempts || keyHit.noop)) {
    return keyHit;
  }
  const labelHit = NOEST_EVENT_MAP[normalizeNoestEventString(description)];
  if (labelHit) return labelHit;
  const fuzzyHit = matchNoestContains(normalizeNoestEventString(activity))
    ?? matchNoestContains(normalizeNoestEventString(description));
  if (fuzzyHit) return fuzzyHit;
  return MAPPING_UNKNOWN;
}

function includesAny(s: string, needles: string[]): boolean {
  return needles.some((n) => s.includes(n));
}

function matchNoestContains(s: string): NoestStatusMapping | null {
  if (!s) return null;
  if (s.includes("retour") && includesAny(s, ["centre", "transit", "en cours", "a retirer"])) {
    return MAPPING_NOOP;
  }
  if (
    includesAny(s, [
      "tentative",
      "injoignable",
      "ne repond pas",
      "pas de reponse",
      "failed attempt",
      "delivery attempt",
    ])
  ) {
    return MAPPING_ATTEMPTS;
  }
  if (
    /\blivre\b/.test(s) ||
    s.includes("livraison effectuee") ||
    s.includes("livraison reussie") ||
    s.includes("delivered")
  ) {
    return MAPPING_DELIVERED;
  }
  if (s.includes("annul") || s.includes("cancel")) {
    return MAPPING_CANCELLED;
  }
  if (s.includes("retourne") || s.includes("retour") || s.includes("returned")) {
    return MAPPING_RETURNED;
  }
  if (
    includesAny(s, [
      "sorti en livraison",
      "en cours de livraison",
      "en livraison",
      "avec livreur",
      "chez livreur",
      "livreur",
      "out for delivery",
    ])
  ) {
    return MAPPING_OUT;
  }
  return null;
}

/** Every string the mapper recognizes — exported for the drift-guard test. */
export const NOEST_DOCUMENTED_EVENT_STRINGS = Object.keys(NOEST_EVENT_MAP);
