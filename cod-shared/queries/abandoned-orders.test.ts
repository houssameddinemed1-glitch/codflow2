/**
 * Abandoned-orders lifecycle tests.
 *
 * Pins the two reported bugs:
 *   1. pending rows never becoming abandoned is fixed by the sweep
 *      (pending → abandoned past the 30-minute cutoff);
 *   2. a converted order must collapse the same shopper's other
 *      pending/abandoned rows — even when the number was typed in another
 *      format (+213… vs 0558…) or the browser convert signal never fired.
 */

import { describe, it, expect, vi } from "vitest";
import {
  normalizeDzPhone,
  phoneMatchVariants,
  reconcileAbandonedOrdersOnOrder,
  purgeStaleAbandonedSiblings,
  sweepPendingToAbandoned,
} from "./abandoned-orders";

/** Minimal drizzle-pg builder mock: every chain step returns a thenable. */
function makeDb(queues: { selects?: unknown[][]; deleted?: unknown[][] } = {}) {
  const selects = [...(queues.selects ?? [])];
  const deleted = [...(queues.deleted ?? [])];
  const updates: unknown[] = [];
  let deleteCalls = 0;

  class Q {
    rows: unknown[];
    constructor(rows: unknown[]) {
      this.rows = rows;
    }
    from() {
      return this;
    }
    where() {
      return this;
    }
    set(arg: unknown) {
      updates.push(arg);
      return this;
    }
    orderBy() {
      return this;
    }
    limit() {
      return this;
    }
    offset() {
      return this;
    }
    returning() {
      this.rows = deleted.length > 0 ? deleted.shift()! : [];
      return this;
    }
    then(resolve: (rows: unknown[]) => unknown) {
      return Promise.resolve(this.rows).then(resolve);
    }
  }

  const db = {
    select: vi.fn(() => new Q(selects.length > 0 ? selects.shift()! : [])),
    selectDistinct: vi.fn(() => new Q(selects.length > 0 ? selects.shift()! : [])),
    update: vi.fn(() => new Q([])),
    delete: vi.fn(() => {
      deleteCalls += 1;
      return new Q([]);
    }),
    insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
  } as any;
  return { db, updates, getDeleteCalls: () => deleteCalls };
}

function openRow(id: string, createdAt: string) {
  return { id, status: "pending", createdAt, updatedAt: createdAt };
}

describe("normalizeDzPhone", () => {
  it("keeps canonical local mobiles untouched", () => {
    expect(normalizeDzPhone("0558919782")).toBe("0558919782");
    expect(normalizeDzPhone("0771397828")).toBe("0771397828");
  });

  it("folds international and spaced spellings to local form", () => {
    expect(normalizeDzPhone("+213558919782")).toBe("0558919782");
    expect(normalizeDzPhone("213558919782")).toBe("0558919782");
    expect(normalizeDzPhone("00213558919782")).toBe("0558919782");
    expect(normalizeDzPhone("0558 91 97 82")).toBe("0558919782");
    expect(normalizeDzPhone("0558-91-97-82")).toBe("0558919782");
  });

  it("rejects non-Algerian-mobile input", () => {
    expect(normalizeDzPhone("123")).toBeNull();
    expect(normalizeDzPhone("0123456789")).toBeNull();
    expect(normalizeDzPhone("call me maybe")).toBeNull();
  });
});

describe("phoneMatchVariants", () => {
  it("covers every spelling of the same number", () => {
    const variants = phoneMatchVariants("0558919782");
    expect(variants).toContain("0558919782");
    expect(variants).toContain("+213558919782");
    expect(variants).toContain("213558919782");
    expect(variants).toContain("00213558919782");
  });
});

describe("reconcileAbandonedOrdersOnOrder", () => {
  it("does nothing when the phone has no checkout rows", async () => {
    const { db, updates, getDeleteCalls } = makeDb({ selects: [[]] });
    await reconcileAbandonedOrdersOnOrder(db, "0558919782", "ord_1", "ORD-1");
    expect(updates).toEqual([]);
    expect(getDeleteCalls()).toBe(0);
  });

  it("converts a lone pending row and deletes nothing", async () => {
    const { db, updates, getDeleteCalls } = makeDb({
      selects: [[openRow("ab_1", "2026-09-26T10:00:00.000Z")]],
    });
    await reconcileAbandonedOrdersOnOrder(db, "0558919782", "ord_1", "ORD-20260926-0001");
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      status: "converted",
      convertedOrderId: "ord_1",
      convertedOrderNumber: "ORD-20260926-0001",
    });
    expect(getDeleteCalls()).toBe(0);
  });

  it("converts the newest row and deletes same-trip duplicates", async () => {
    const { db, updates, getDeleteCalls } = makeDb({
      selects: [
        [
          openRow("ab_new", "2026-09-26T12:00:00.000Z"),
          openRow("ab_old", "2026-09-26T11:00:00.000Z"),
        ],
      ],
    });
    await reconcileAbandonedOrdersOnOrder(db, "0558919782", "ord_1", "ORD-1");
    expect(updates).toHaveLength(1);
    expect(getDeleteCalls()).toBe(1);
  });

  it("purges stale rows from previous purchases but converts the fresh one", async () => {
    const { db, updates, getDeleteCalls } = makeDb({
      selects: [
        [
          openRow("ab_fresh", "2026-09-26T12:00:00.000Z"),
          {
            id: "ab_conv",
            status: "converted",
            createdAt: "2026-09-25T10:00:00.000Z",
            updatedAt: "2026-09-25T10:05:00.000Z",
          },
          openRow("ab_stale", "2026-09-25T09:00:00.000Z"),
        ],
      ],
    });
    await reconcileAbandonedOrdersOnOrder(db, "0558919782", "ord_2", "ORD-2");
    expect(updates).toHaveLength(1);
    // stale leftover delete + fresh-duplicate delete (none here beyond stale)
    expect(getDeleteCalls()).toBe(1);
  });
});

describe("purgeStaleAbandonedSiblings", () => {
  it("purges every open sibling of a converted phone, whatever its age", async () => {
    const { db } = makeDb({
      selects: [[{ phone: "0558919782" }]],
      deleted: [[{ id: "ab_old" }, { id: "ab_new" }]],
    });
    const purged = await purgeStaleAbandonedSiblings(db);
    expect(purged).toBe(2);
  });

  it("returns 0 when nothing converted yet", async () => {
    const { db } = makeDb({ selects: [[]] });
    expect(await purgeStaleAbandonedSiblings(db)).toBe(0);
  });
});

describe("sweepPendingToAbandoned", () => {
  it("returns the flipped count", async () => {
    const { db } = makeDb({ deleted: [[{ id: "a" }, { id: "b" }, { id: "c" }]] });
    expect(await sweepPendingToAbandoned(db)).toBe(3);
  });
});
