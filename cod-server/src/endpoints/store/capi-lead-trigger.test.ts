/**
 * CAPI Lead trigger — drives the real createStoreOrder handler through the
 * mounted store router, pinning the QStash port of the old durable workflow:
 *   - every order publishes a "capi" job (dedup capi-{orderId}-checkout-{event})
 *   - publishing is awaited inline and fail-open (a rejection never blocks 201)
 *   - pixel disabled → no publish, order still 201
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import storeRouter from "./routes";
import * as storeQueries from "./queries";
import { publishWorkflow } from "@/lib/queue";

vi.mock("@/db", () => ({ getDb: vi.fn(() => testDb) }));
vi.mock("./queries");
vi.mock("@/lib/queue", () => ({ publishWorkflow: vi.fn(async () => true) }));
vi.mock("../../../../cod-shared/queries/otp-config", () => ({
  getOtpConfigRaw: vi.fn(async () => undefined),
}));
vi.mock("../../../../cod-shared/queries/turnstile-config");
vi.mock("../../../../cod-shared/queries/pixel-config", () => ({
  getPixelConfig: vi.fn(async () => undefined),
}));
vi.mock("../../../../cod-shared/queries/tiktok-config", () => ({
  getTiktokConfig: vi.fn(async () => undefined),
}));
import { getPixelConfig } from "../../../../cod-shared/queries/pixel-config";

let testDb: any;

function orderBody(overrides: Record<string, unknown> = {}) {
  return {
    customerName: "Karim Benali",
    phone: "0551234567",
    wilayaId: 16,
    communeId: "c-16-001",
    deliveryType: "home",
    productId: "prod-1",
    productName: "T-shirt",
    quantity: 1,
    pricePerUnit: 2500,
    fbc: "fb.1.1700000000.abc",
    fbp: "fb.1.1700000001.123",
    ...overrides,
  };
}

function makeApp() {
  const app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
  // Functional db stub: config lookups run (returning no rows) so the mocked
  // getPixelConfig decides the mode; store-domain lookup resolves empty.
  // getDb is mocked to return this stub (c.env.DB is bypassed by the mock).
  testDb = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve([]).then(resolve),
        })),
      })),
    })),
  };
  app.use("*", async (c, next) => {
    c.env = { DB: testDb } as any;
    c.set("storeId", "store-1");
    await next();
  });
  app.onError(errorHandler);
  app.route("/store", storeRouter);
  return app;
}

function stubSuccessfulOrderFlow() {
  vi.mocked(storeQueries.validateOrderSkus).mockResolvedValue(null as any);
  vi.mocked(storeQueries.checkStoreOrderStock).mockResolvedValue(null as any);
  vi.mocked(storeQueries.findOrCreateCustomer).mockResolvedValue({ id: "cust-1", name: "Karim Benali" } as any);
  vi.mocked(storeQueries.getDeliveryFee).mockResolvedValue(600 as any);
  vi.mocked(storeQueries.createStoreOrder).mockResolvedValue({
    id: "ord-1",
    orderNumber: "ORD-20260901-0001",
    price: 2500,
    deliveryFee: 600,
  } as any);
  // Lead mode fires a Lead event at checkout.
  vi.mocked(getPixelConfig).mockResolvedValue({ conversionEvent: "Lead", enabled: true } as any);
}

async function placeOrder(
  app: ReturnType<typeof makeApp>,
  headers: Record<string, string> = {}
) {
  const pending: Promise<unknown>[] = [];
  const executionCtx = {
    waitUntil: (p: Promise<unknown>) => pending.push(p),
    passThroughOnException: () => {},
    props: {} as Record<string, unknown>,
  };
  const res = await app.request(
    "/store/orders",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Store-API-Key": "key",
        "CF-Connecting-IP": "41.100.1.1",
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://shop.example/prod",
        ...headers,
      },
      body: JSON.stringify(orderBody()),
    },
    undefined,
    executionCtx
  );
  await Promise.allSettled(pending);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  stubSuccessfulOrderFlow();
});

describe("CAPI checkout trigger (QStash)", () => {
  type PublishCall = [string, Record<string, unknown>, string];
  const capiCalls = () =>
    (vi.mocked(publishWorkflow).mock.calls as unknown as PublishCall[]).filter(
      ([kind]) => kind === "capi",
    );

  it("publishes a capi job for the order at checkout", async () => {
    const before = Math.floor(Date.now() / 1000);

    const res = await placeOrder(makeApp());

    expect(res.status).toBe(201);
    expect(capiCalls()).toHaveLength(1);
    const [kind, payload, dedupId] = capiCalls()[0];
    expect(kind).toBe("capi");
    expect(dedupId).toBe("capi-ord-1-checkout-Lead");
    expect(payload.orderId).toBe("ord-1");
    expect(payload.eventName).toBe("Lead");
    expect(payload.stage).toBe("checkout");
    expect(payload.triggerStatus).toBe("order_created");
    expect(payload.eventSourceUrl).toBe("https://shop.example/prod");
    expect(payload.triggeredAt).toBeGreaterThanOrEqual(before);
    expect(payload.triggeredAt).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
  });

  it("still returns 201 when publishing rejects (fail-open)", async () => {
    vi.mocked(publishWorkflow).mockRejectedValueOnce(new Error("QStash down"));

    const res = await placeOrder(makeApp());

    expect(res.status).toBe(201);
    expect(capiCalls()).toHaveLength(1);
  });

  it("publishes no capi job when the mode defers past checkout, order still 201", async () => {
    // Purchase_Confirmed fires at phone confirmation, never at checkout.
    vi.mocked(getPixelConfig).mockResolvedValue({ conversionEvent: "Purchase_Confirmed", enabled: true } as any);

    const res = await placeOrder(makeApp());

    expect(res.status).toBe(201);
    expect(capiCalls()).toHaveLength(0);
  });

  it("normalizes an E.164 phone to the canonical local form before storing", async () => {
    const res = await placeOrder(makeApp());

    expect(res.status).toBe(201);
    const orderArg = vi.mocked(storeQueries.createStoreOrder).mock.calls[0][1];
    expect(orderArg.phone).toBe("0551234567");
  });
});
