import { describe, it, expect } from "vitest";
import {
  resolveTiktokForStage,
  resolveTiktokDispatch,
  getTiktokWorkflowId,
} from "./tiktok-conversion-model";

/**
 * TikTok conversion model — mirrors the Meta conversion-model contract but
 * maps onto TikTok's standard web events (CompletePayment / SubmitForm) and a
 * separate `tiktok-` workflow idempotency namespace.
 */

describe("resolveTiktokForStage", () => {
  it("Purchase fires CompletePayment at checkout only", () => {
    expect(resolveTiktokForStage("Purchase", "checkout")).toMatchObject({
      shouldFire: true,
      eventName: "CompletePayment",
    });
    expect(resolveTiktokForStage("Purchase", "confirmed").shouldFire).toBe(false);
    expect(resolveTiktokForStage("Purchase", "delivered").shouldFire).toBe(false);
  });

  it("Lead fires SubmitForm at checkout only", () => {
    expect(resolveTiktokForStage("Lead", "checkout")).toMatchObject({
      shouldFire: true,
      eventName: "SubmitForm",
    });
    expect(resolveTiktokForStage("Lead", "confirmed").shouldFire).toBe(false);
  });

  it("Purchase_Confirmed fires CompletePayment at confirmation only", () => {
    expect(resolveTiktokForStage("Purchase_Confirmed", "confirmed")).toMatchObject({
      shouldFire: true,
      eventName: "CompletePayment",
    });
    expect(resolveTiktokForStage("Purchase_Confirmed", "checkout").shouldFire).toBe(false);
    expect(resolveTiktokForStage("Purchase_Confirmed", "delivered").shouldFire).toBe(false);
  });

  it("Purchase_Delivered fires CompletePayment at delivery only", () => {
    expect(resolveTiktokForStage("Purchase_Delivered", "delivered")).toMatchObject({
      shouldFire: true,
      eventName: "CompletePayment",
    });
    expect(resolveTiktokForStage("Purchase_Delivered", "checkout").shouldFire).toBe(false);
  });
});

describe("resolveTiktokDispatch", () => {
  it("refuses when TikTok tracking is disabled or tokenless", () => {
    expect(
      resolveTiktokDispatch({ enabled: false, accessToken: "x", conversionEvent: "Purchase", testMode: false, testEventCode: null }, "CompletePayment", "checkout")
    ).toMatchObject({ send: false, reason: "tracking-disabled" });
    expect(
      resolveTiktokDispatch({ enabled: true, accessToken: "", conversionEvent: "Purchase", testMode: false, testEventCode: null }, "CompletePayment", "checkout")
    ).toMatchObject({ send: false, reason: "no-access-token" });
  });

  it("refuses the wrong event for the mode", () => {
    expect(
      resolveTiktokDispatch({ enabled: true, accessToken: "x", conversionEvent: "Lead", testMode: false, testEventCode: null }, "CompletePayment", "checkout")
    ).toMatchObject({ send: false, reason: "conversion-event-mismatch" });
  });

  it("sends with test code only in test mode", () => {
    expect(
      resolveTiktokDispatch({ enabled: true, accessToken: "x", conversionEvent: "Purchase", testMode: true, testEventCode: "T1" }, "CompletePayment", "checkout")
    ).toEqual({ send: true, testEventCode: "T1" });
    expect(
      resolveTiktokDispatch({ enabled: true, accessToken: "x", conversionEvent: "Purchase", testMode: false, testEventCode: "T1" }, "CompletePayment", "checkout")
    ).toEqual({ send: true, testEventCode: null });
  });
});

describe("getTiktokWorkflowId", () => {
  it("uses a tiktok- namespace distinct from capi-", () => {
    expect(getTiktokWorkflowId("o1", "checkout", "CompletePayment")).toBe("tiktok-o1-checkout-CompletePayment");
  });
});
