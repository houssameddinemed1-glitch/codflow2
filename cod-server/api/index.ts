/**
 * Vercel Serverless entry point.
 *
 * Vercel detects the default export as a standard Request→Response handler.
 * We build a per-request Env shim from process.env so every `c.env.X` call
 * site works without touching the handler code.
 */
import type { AppContext } from "@/types";
import { buildEnv } from "@/types/env";

// The Hono app is the same one used by the old Worker — every middleware
// and route is already mounted on it. We just wrap it for Vercel's
// request shape.
import app from "@/index";

function getProtoAndHost(req: any): { proto: string; host: string } {
  const forwardedProto = req.headers?.["x-forwarded-proto"];
  const proto =
    (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto?.split(",")[0]) ||
    "https";
  const host =
    req.headers?.host || req.headers?.[":authority"] || "localhost";
  return { proto, host };
}

function toWebRequest(req: any): Request {
  // Vercel may already hand us a web-standard Request.
  if (typeof Request !== "undefined" && req instanceof Request) return req;
  const { proto, host } = getProtoAndHost(req);
  const url = req.url?.startsWith("http")
    ? req.url
    : `${proto}://${host}${req.url || "/"}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers || {})) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      for (const item of v) headers.append(k, String(item));
    } else {
      headers.set(k, String(v));
    }
  }
  const method = (req.method || "GET").toUpperCase();
  const init: RequestInit & { duplex?: "half" } = { method, headers };
  if (method !== "GET" && method !== "HEAD") {
    const b: any = req.body;
    if (b != null) {
      if (
        typeof b === "string" ||
        b instanceof Uint8Array ||
        b instanceof ArrayBuffer ||
        (typeof Blob !== "undefined" && b instanceof Blob) ||
        (typeof ReadableStream !== "undefined" && b instanceof ReadableStream) ||
        typeof b.pipe === "function"
      ) {
        // Raw body — streams need duplex: half on Node 18+, otherwise
        // undici cannot parse the body.
        init.body = b as BodyInit;
        if (typeof b.pipe === "function") init.duplex = "half";
      } else {
        // Pre-parsed body (e.g. a JSON object) — re-serialize it.
        init.body = JSON.stringify(b);
      }
    } else if (typeof req.pipe === "function" && !req.readableEnded) {
      // Raw Node IncomingMessage: stream the request body through directly.
      init.body = req as unknown as BodyInit;
      init.duplex = "half";
    }
  }
  return new Request(url, init);
}

async function runApp(webReq: Request): Promise<Response> {
  const env = buildEnv();
  // Hono's `app.fetch(request, env)` sets `c.env` to `env` for every route.
  // Our middleware reads c.env.X — this shim populates it from process.env.
  return app.fetch(webReq, env as any);
}

function sendWebResponse(webRes: Response, nodeRes: any): void {
  nodeRes.statusCode = webRes.status;
  webRes.headers.forEach((value, key) => {
    // Multiple Set-Cookie values need an array.
    if (key.toLowerCase() === "set-cookie") {
      const existing = nodeRes.getHeader?.(key);
      nodeRes.setHeader(
        key,
        existing ? [...(Array.isArray(existing) ? existing : [existing]), value] : value,
      );
    } else {
      nodeRes.setHeader(key, value);
    }
  });
  // Buffered send — API payloads are small JSON; avoids streaming edge cases.
  webRes.arrayBuffer().then(
    (buf) => nodeRes.end(Buffer.from(buf)),
    () => nodeRes.end(),
  );
}

// Vercel Node serverless signature: (req, res). Also tolerates being
// invoked with a bare web-standard Request (returns a Response).
const handler = async (req: any, res?: any): Promise<Response | void> => {
  const webReq = toWebRequest(req);
  const webRes = await runApp(webReq);
  if (res && typeof res.setHeader === "function") {
    sendWebResponse(webRes, res);
    return;
  }
  return webRes;
};

export default handler;

export const config = {
  // Let Vercel handle the runtime config.
};
