/**
 * Shared TikTok Events API Conversion Model for CodFlow.
 *
 * Same 4 merchant modes as Meta (chosen independently per platform in
 * Settings → Tracking), mapped onto TikTok's standard web events:
 *
 * | Configuration        | Business stage       | TikTok event     |
 * |----------------------|----------------------|------------------|
 * | Lead                 | Checkout             | SubmitForm       |
 * | Purchase             | Checkout             | CompletePayment  |
 * | Purchase_Confirmed   | Phone confirmation   | CompletePayment  |
 * | Purchase_Delivered   | Delivery/payment     | CompletePayment  |
 *
 * Dedup contract (per TikTok docs): pixel_code + event + event_id must match
 * between the browser ttq call and this server call. event_id is the order ID.
 */

export type TiktokStage = "checkout" | "confirmed" | "delivered";
export type TiktokEventName = "CompletePayment" | "SubmitForm";
export type TiktokMode = "Purchase" | "Purchase_Confirmed" | "Purchase_Delivered" | "Lead";

export interface TiktokDecision {
  shouldFire: boolean;
  eventName?: TiktokEventName;
  stage?: TiktokStage;
  reason?: string;
}

export function resolveTiktokForStage(
  mode: TiktokMode | null | undefined,
  stage: TiktokStage
): TiktokDecision {
  const resolvedMode: TiktokMode = mode ?? "Purchase";

  switch (stage) {
    case "checkout":
      if (resolvedMode === "Purchase") {
        return { shouldFire: true, eventName: "CompletePayment", stage: "checkout" };
      }
      if (resolvedMode === "Lead") {
        return { shouldFire: true, eventName: "SubmitForm", stage: "checkout" };
      }
      return {
        shouldFire: false,
        reason: `TikTok conversion mode is '${resolvedMode}' — checkout stage does not fire a conversion event.`,
      };

    case "confirmed":
      if (resolvedMode === "Purchase_Confirmed") {
        return { shouldFire: true, eventName: "CompletePayment", stage: "confirmed" };
      }
      return {
        shouldFire: false,
        reason: `TikTok conversion mode is '${resolvedMode}' — phone confirmation stage does not fire a conversion event.`,
      };

    case "delivered":
      if (resolvedMode === "Purchase_Delivered") {
        return { shouldFire: true, eventName: "CompletePayment", stage: "delivered" };
      }
      return {
        shouldFire: false,
        reason: `TikTok conversion mode is '${resolvedMode}' — delivery stage does not fire a conversion event.`,
      };

    default:
      return { shouldFire: false, reason: `Unknown stage: ${stage}` };
  }
}

/**
 * Centralized deterministic Workflow ID constructor.
 * Distinct prefix from CAPI (`tiktok-` vs `capi-`) so the two platforms'
 * idempotency namespaces never collide.
 */
export function getTiktokWorkflowId(
  orderId: string,
  stage: TiktokStage,
  eventName: TiktokEventName
): string {
  return `tiktok-${orderId}-${stage}-${eventName}`;
}

export interface TiktokDispatchConfig {
  enabled: boolean;
  accessToken: string;
  conversionEvent: TiktokMode;
  testMode: boolean;
  testEventCode: string | null;
}

export type TiktokSkipReason =
  | "tracking-disabled"
  | "no-access-token"
  | "conversion-event-mismatch";

export type TiktokDispatch =
  | { send: true; testEventCode: string | null }
  | { send: false; reason: TiktokSkipReason; message: string };

/**
 * Single gate for every TikTok send: the store's TikTok tracking must be
 * enabled, carry an access token, and the merchant must have chosen
 * `eventName` as the conversion event for the given business stage.
 * Reads ONLY the TikTok config — Meta's config never influences this.
 */
export function resolveTiktokDispatch(
  config: TiktokDispatchConfig | null | undefined,
  eventName: TiktokEventName,
  stage?: TiktokStage,
): TiktokDispatch {
  if (!config?.enabled) {
    return { send: false, reason: "tracking-disabled", message: "TikTok tracking disabled in store settings" };
  }
  if (!config.accessToken) {
    return {
      send: false,
      reason: "no-access-token",
      message: "No TikTok Events API token — configure it in Settings → Tracking",
    };
  }

  if (stage) {
    const decision = resolveTiktokForStage(config.conversionEvent, stage);
    if (!decision.shouldFire || decision.eventName !== eventName) {
      return {
        send: false,
        reason: "conversion-event-mismatch",
        message: decision.reason ?? `TikTok conversion event is set to ${config.conversionEvent} — ${eventName} not sent at stage ${stage}`,
      };
    }
  } else {
    const allowed =
      (eventName === "CompletePayment" &&
        (config.conversionEvent === "Purchase" ||
          config.conversionEvent === "Purchase_Confirmed" ||
          config.conversionEvent === "Purchase_Delivered")) ||
      (eventName === "SubmitForm" && config.conversionEvent === "Lead");

    if (!allowed) {
      return {
        send: false,
        reason: "conversion-event-mismatch",
        message: `TikTok conversion event is set to ${config.conversionEvent} — ${eventName} not sent`,
      };
    }
  }

  return { send: true, testEventCode: config.testMode ? config.testEventCode : null };
}
