import { Client as QStashClient, Receiver } from "@upstash/qstash";

export type WorkflowKind = "capi" | "tiktok" | "lp-image-upload";

let client: QStashClient | null = null;
let resolved = false;

function qstash(): QStashClient | null {
  if (!resolved) {
    resolved = true;
    const token = process.env.QSTASH_TOKEN;
    client = token ? new QStashClient({ token }) : null;
  }
  return client;
}

/**
 * Enqueue background work. Fail-open by contract (mirrors the old missing
 * workflow-binding path): marketing attribution and AI uploads must never
 * block order or delivery confirmation. Returns false when skipped.
 */
export async function publishWorkflow(
  kind: WorkflowKind,
  payload: unknown,
  deduplicationId?: string,
): Promise<boolean> {
  return (await publishWorkflowWithId(kind, payload, deduplicationId)).ok;
}

/**
 * Same as publishWorkflow but also returns the QStash message id — callers
 * that hand a polling handle back (landing-page image uploads) need it to
 * correlate. Fail-open contract identical to publishWorkflow.
 */
export async function publishWorkflowWithId(
  kind: WorkflowKind,
  payload: unknown,
  deduplicationId?: string,
): Promise<{ ok: boolean; messageId?: string }> {
  const appUrl =
    process.env.WORKER_SELF_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
  const q = qstash();
  if (!q || !appUrl) {
    console.warn(`[queue] ${kind} skipped — QStash or app URL not configured`);
    return { ok: false };
  }
  try {
    const res = await q.publishJSON({
      url: `${appUrl.replace(/\/$/, "")}/api/internal/workflows/${kind}`,
      body: payload,
      retries: 5,
      ...(deduplicationId ? { deduplicationId } : {}),
    });
    return { ok: true, messageId: res.messageId };
  } catch (err) {
    console.warn(`[queue] ${kind} publish failed:`, err instanceof Error ? err.message : String(err));
    return { ok: false };
  }
}

/** Verify an inbound QStash delivery signature. False = reject with 401. */
export async function verifyQstashRequest(request: Request): Promise<boolean> {
  const current = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const next = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!current || !next) return false;
  try {
    const receiver = new Receiver({ currentSigningKey: current, nextSigningKey: next });
    const signature = request.headers.get("upstash-signature");
    if (!signature) return false;
    const body = await request.clone().text();
    return await receiver.verify({ signature, body });
  } catch {
    return false;
  }
}
