/**
 * Proves the templates survive the sanitiser byte-for-byte — R5/R6 in
 * report-md/LEGAL_PAGES_PLAN.md.
 *
 * Upstream runs `sanitizeRichText`/`toPlainText` inside workerd (Miniflare)
 * because its implementation used Cloudflare's HTMLRewriter. This tree runs on
 * Node, and `cod-shared/lib/rich-text.ts` is the dependency-free port of the
 * same allow-list — so these tests call it directly.
 *
 * If a template ever used a tag or attribute the allow-list would strip,
 * this is the test that catches it: R5 claims the serializer emits nothing
 * else, and this is what makes that claim true rather than merely asserted.
 */

import { describe, expect, it } from "vitest";
import { LEGAL_PAGE_KINDS, PAGE_LOCALES } from "./kinds";
import type { LegalPageKind, PageLocale } from "./kinds";
import { TEMPLATES } from "./render";
import { serializeLegalDocument } from "./serialize";
import type { StoreLegalFacts } from "./types";
import { sanitizeRichText, toPlainText } from "../lib/rich-text";

const BARE: StoreLegalFacts = {
  storeName: "متجر تجريبي",
  legalName: null,
  rcNumber: null,
  nif: null,
  address: null,
  contactEmail: null,
  contactPhone: null,
  returnWindowDays: 0,
  deliveryMinDays: 2,
  deliveryMaxDays: 7,
};

const FULL: StoreLegalFacts = {
  storeName: "Boutique Test",
  legalName: "SARL Test Commerce",
  rcNumber: "16/00-1234567B25",
  nif: "000116001234567",
  address: "12 rue des Frères Bouadou, Bir Mourad Raïs, Alger",
  contactEmail: "contact@example.dz",
  contactPhone: "+213 555 00 00 00",
  returnWindowDays: 7,
  deliveryMinDays: 1,
  deliveryMaxDays: 5,
};

const CASES: ReadonlyArray<[PageLocale, LegalPageKind]> = PAGE_LOCALES.flatMap(
  (locale) => LEGAL_PAGE_KINDS.map((kind) => [locale, kind] as [PageLocale, LegalPageKind]),
);

describe("template output passes sanitizeRichText unchanged", () => {
  it.each(CASES)("%s / %s (bare facts)", async (locale, kind) => {
    const html = serializeLegalDocument(TEMPLATES[locale][kind](BARE));
    const { html: sanitised, removed } = await sanitizeRichText(html);
    expect(removed, `sanitizer stripped something from ${locale}/${kind}`).toEqual([]);
    expect(sanitised).toBe(html);
  });

  it.each(CASES)("%s / %s (full facts)", async (locale, kind) => {
    const html = serializeLegalDocument(TEMPLATES[locale][kind](FULL));
    const { html: sanitised, removed } = await sanitizeRichText(html);
    expect(removed, `sanitizer stripped something from ${locale}/${kind}`).toEqual([]);
    expect(sanitised).toBe(html);
  });
});

describe("toPlainText derives non-empty, tag-free body_plain", () => {
  it.each(CASES)("%s / %s", async (locale, kind) => {
    const html = serializeLegalDocument(TEMPLATES[locale][kind](FULL));
    const plain = await toPlainText(html);
    expect(plain.length).toBeGreaterThan(0);
    expect(plain).not.toMatch(/<[^>]+>/);
  });
});
