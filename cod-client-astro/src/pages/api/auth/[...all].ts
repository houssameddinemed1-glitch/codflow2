import type { APIRoute } from "astro";
import { buildAuthEnvFromProcessEnv, createAuth } from "@/lib/auth/server";

export const prerender = false;

const ALL: APIRoute = async (ctx) => {
  const auth = createAuth(buildAuthEnvFromProcessEnv());
  return auth.handler(ctx.request);
};

export const GET = ALL;
export const POST = ALL;
