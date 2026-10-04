import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { buildAuthEnv, createAuth } from "@/lib/auth/server";

export const prerender = false;

const ALL: APIRoute = async (ctx) => {
  const auth = createAuth(buildAuthEnv(env as unknown as Record<string, any>));
  return auth.handler(ctx.request);
};

export const GET = ALL;
export const POST = ALL;
