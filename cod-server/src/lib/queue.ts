import { Client as QStashClient, Receiver } from "@upstash/qstash";

export type WorkflowKind = "capi" | "tiktok" | "lp-image-upload";

/** Minimal env surface the queue needs: workflow bindings only. Both the full
 *  Worker `Env` and subsets like `LandingPageToolEnv` satisfy this. */
export interface WorkflowEnvLike {
  CAPI_WORKFLOW?: any;
  TIKTOK_WORKFLOW?: any;
  LP_IMAGE_UPLOAD_WORKFLOW?: any;
}

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

function workflowBinding(env: WorkflowEnvLike | undefined, kind: WorkflowKind): any | null {
  if (!env) return null;
  if (kind === "capi") return env.CAPI_WORKFLOW ?? null;
  if (kind === "tiktok") return env.TIKTOK_WORKFLOW ?? null;
  return env.LP_IMAGE_UPLOAD_WORKFLOW ?? null;
}

function newId(fallback?: string): string {
  if (fallback && fallback.length > 0) return fallback;
  try {
    return crypto.randomUUID();
  } catch {
    return `wf-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }
}

/**
 * Enqueue background work. Fail-open by contract: marketing attribution and
 * AI uploads must never block order or delivery confirmation.
 *
 * Cloudflare-first: when `env` carries the workflow binding for `kind`, the
 * durable Cloudflare Workflow is used (no extra vendor). Otherwise falls back
 * to QStash HTTP callbacks (Vercel-stack path, local dev, tests).
 *
 * Overloads keep existing callers compiling:
 *   publishWorkflow(kind, payload, id?)
 *   publishWorkflow(env, kind, payload, id?)
 */
export async function publishWorkflow(kind: WorkflowKind, payload: unknown, deduplicationId?: string): Promise<boolean>;
export async function publishWorkflow(env: WorkflowEnvLike | undefined, kind: WorkflowKind, payload: unknown, deduplicationId?: string): Promise<boolean>;
export async function publishWorkflow(
  a: WorkflowEnvLike | undefined | WorkflowKind,
  b: WorkflowKind | unknown,
  c?: unknown | string,
  d?: string,
): Promise<boolean> {
  return (await publishWorkflowWithId(a as any, b as any, c as any, d as any)).ok;
}

/**
 * Same as publishWorkflow but also returns the durable id — callers that hand
 * a polling handle back (landing-page image uploads) need it to correlate.
 * For Workflows the id is the instance id; for QStash it is the message id.
 */
export async function publishWorkflowWithId(
  kind: WorkflowKind,
  payload: unknown,
  deduplicationId?: string,
): Promise<{ ok: boolean; messageId?: string }>;
export async function publishWorkflowWithId(
  env: WorkflowEnvLike | undefined,
  kind: WorkflowKind,
  payload: unknown,
  deduplicationId?: string,
): Promise<{ ok: boolean; messageId?: string }>;
export async function publishWorkflowWithId(
  a: WorkflowEnvLike | undefined | WorkflowKind,
  b: WorkflowKind | unknown,
  c?: unknown | string,
  d?: string,
): Promise<{ ok: boolean; messageId?: string }> {
  let env: WorkflowEnvLike | undefined;
  let kind: WorkflowKind;
  let payload: unknown;
  let deduplicationId: string | undefined;
  if (typeof a === "string") {
    env = undefined;
    kind = a as WorkflowKind;
    payload = b;
    deduplicationId = c as string | undefined;
  } else {
    env = (a as WorkflowEnvLike | undefined) ?? undefined;
    kind = b as WorkflowKind;
    payload = c;
    deduplicationId = d;
  }

  const binding = workflowBinding(env, kind);
  if (binding && typeof binding.create === "function") {
    const id = newId(deduplicationId);
    try {
      await binding.create({ id, params: payload });
      return { ok: true, messageId: id };
    } catch (err) {
      console.warn(`[queue] ${kind} workflow create failed:`, err instanceof Error ? err.message : String(err));
      return { ok: false };
    }
  }

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
