/**
 * NOEST Status Mapper — Tests.
 *
 * Verifies definitive outcomes map, transit/payment strings are deliberate
 * no-ops, unknown strings are reported (never guessed), slug→label
 * fallback works, and every table key is stored pre-normalized.
 */

import { describe, it, expect } from "vitest";
import {
  mapNoestEvent,
  normalizeNoestEventString,
  NOEST_DOCUMENTED_EVENT_STRINGS,
} from "./status-mapping";

describe("mapNoestEvent", () => {
  it("maps definitive terminal outcomes", () => {
    expect(mapNoestEvent("livre", "Livré")).toEqual({ status: "delivered", incrementAttempts: false, noop: false });
    expect(mapNoestEvent("?", "Livré non encaissé")).toMatchObject({ status: "delivered" });
    expect(mapNoestEvent("annule", "Annulé")).toMatchObject({ status: "cancelled" });
    expect(mapNoestEvent("?", "Retourné au vendeur")).toMatchObject({ status: "returned" });
  });

  it("is accent- and case-insensitive", () => {
    expect(mapNoestEvent("LIVRÉ", "LIVRÉ")).toMatchObject({ status: "delivered" });
    expect(mapNoestEvent("Sorti En Livraison", undefined)).toMatchObject({ status: "out_for_delivery" });
  });

  it("maps failed attempts to out_for_delivery with the counter flag", () => {
    expect(mapNoestEvent("tentative de livraison", "Tentative de livraison")).toEqual({
      status: "out_for_delivery",
      incrementAttempts: true,
      noop: false,
    });
  });

  it("treats transit, pickup, draft and waiting strings as deliberate no-ops", () => {
    for (const s of ["upload", "Uploadé sur le système", "Validé", "Ramassé", "En transit", "Arrivé au centre", "En attente", "Retour vers centre"]) {
      expect(mapNoestEvent(s, s)).toMatchObject({ status: null, noop: true });
    }
  });

  it("never turns payment/finance events into movement", () => {
    for (const s of ["Encaissement", "Paiement", "Facture", "mise_a_jour"]) {
      expect(mapNoestEvent(s, s)).toMatchObject({ status: null, noop: true });
    }
  });

  it("falls back to the French label when the slug is unknown", () => {
    expect(mapNoestEvent("some_new_slug", "Livré")).toMatchObject({ status: "delivered" });
  });

  it("recognizes longer carrier sentences with extra words", () => {
    expect(mapNoestEvent("colis_livre_avec_succes", "Colis livré avec succès")).toMatchObject({ status: "delivered" });
    expect(mapNoestEvent("livraison_effectuee_avec_succes", "Livraison effectuée avec succès")).toMatchObject({ status: "delivered" });
    expect(mapNoestEvent("sorti_en_livraison_centre", "Sorti en livraison - centre Alger")).toMatchObject({ status: "out_for_delivery" });
    expect(mapNoestEvent("tentative_de_livraison_1", "Tentative de livraison 1 - client injoignable")).toMatchObject({ status: "out_for_delivery", incrementAttempts: true });
  });

  it("reports unknown strings instead of guessing", () => {
    expect(mapNoestEvent("mystery_slug", "Statut mystérieux")).toEqual({
      status: null,
      incrementAttempts: false,
      noop: false,
    });
    expect(mapNoestEvent(undefined, undefined)).toEqual({
      status: null,
      incrementAttempts: false,
      noop: false,
    });
  });

  it("keeps every table key pre-normalized (drift guard)", () => {
    expect(NOEST_DOCUMENTED_EVENT_STRINGS.length).toBeGreaterThan(30);
    for (const key of NOEST_DOCUMENTED_EVENT_STRINGS) {
      expect(normalizeNoestEventString(key)).toBe(key);
    }
  });
});
