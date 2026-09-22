import { Hono } from "hono";
import type { AppContext } from "@/types";
import { verifyQstashRequest } from "@/lib/queue";
import { runCapiEvent } from "./run-capi";
import { runTiktokEvent } from "./run-tiktok";

/**
 * Internal background-work endpoints, called ONLY by QStash (signature
 * verified per request). Mounted BEFORE the merchant auth middleware —
 * QStash carries no merchant JWT. A 500 response makes QStash retry; the
 * run functions only throw on send failure (retry-worthy), every early
 * exit returns 200 (no retry).
 */
export const internalWorkflowsRouter = new Hono<AppContext>();

internalWorkflowsRouter.post("/capi", async (c) => {
  if (!(await verifyQstashRequest(c.req.raw))) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  try {
    const result = await runCapiEvent(await c.req.json());
    return c.json({ success: true, data: result }, 200);
  } catch (err) {
    console.error("[workflow][capi] failed:", err instanceof Error ? err.message : String(err));
    return c.json({ success: false, error: "CAPI send failed" }, 500);
  }
});

internalWorkflowsRouter.post("/tiktok", async (c) => {
  if (!(await verifyQstashRequest(c.req.raw))) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  try {
    const result = await runTiktokEvent(await c.req.json());
    return c.json({ success: true, data: result }, 200);
  } catch (err) {
    console.error("[workflow][tiktok] failed:", err instanceof Error ? err.message : String(err));
    return c.json({ success: false, error: "TikTok send failed" }, 500);
  }
});
