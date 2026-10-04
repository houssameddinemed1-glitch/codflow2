import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { customSession, jwt } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/d1";
import type { D1Database, KVNamespace } from "@cloudflare/workers-types";
import * as schema from "../../../../cod-shared/db/schema";
import { userScopes } from "../../../../cod-shared/db/schema";
import { getStore } from "../../../../cod-shared/queries/stores";
import { renderPasswordResetEmail } from "../../../../cod-shared/lib/email-templates";
import { sendTransactionalEmail } from "../../../../cod-shared/lib/transactional-email";
import { eq } from "drizzle-orm";

export interface AuthEnv {
  /** D1 database binding (shared auth database with cod-server). */
  DB: D1Database;
  /** KV namespace for rate-limit + session secondary storage. */
  RATE_LIMIT_KV: KVNamespace;
  PUBLIC_APP_URL: string;
  PUBLIC_API_URL: string;
  PUBLIC_TRUSTED_ORIGINS?: string;
  BETTER_AUTH_SECRET: string;
  /**
   * HMAC secret (>= 32 bytes) shared with cod-server for the MCP OAuth login
   * tickets minted after a successful sign-in. Optional: when missing or too
   * short, the MCP authorize relay fails closed.
   */
  MCP_LOGIN_TICKET_SECRET?: string;
}

function required(value: string | undefined, name: string, hint: string): string {
  if (!value) {
    throw new Error(`Auth misconfigured: ${name} is not set. ${hint}`);
  }
  return value;
}

/**
 * Build the AuthEnv from the Cloudflare Workers bindings + vars.
 * Called per SSR request with the worker env (Astro: runtime env).
 */
export function buildAuthEnv(env: Record<string, any>): AuthEnv {
  const pick = (name: string): string | undefined => {
    const v = env[name];
    return typeof v === "string" && v.length > 0 ? v : undefined;
  };
  const db = env.DB as D1Database | undefined;
  if (!db) throw new Error("Auth misconfigured: DB binding is not set.");
  const kv = env.RATE_LIMIT_KV as KVNamespace | undefined;
  if (!kv) throw new Error("Auth misconfigured: RATE_LIMIT_KV binding is not set.");
  return {
    DB: db,
    RATE_LIMIT_KV: kv,
    PUBLIC_APP_URL: required(pick("PUBLIC_APP_URL"), "PUBLIC_APP_URL", "Set the dashboard's public origin."),
    PUBLIC_API_URL: required(pick("PUBLIC_API_URL"), "PUBLIC_API_URL", "Set the API origin."),
    PUBLIC_TRUSTED_ORIGINS: pick("PUBLIC_TRUSTED_ORIGINS"),
    BETTER_AUTH_SECRET: required(
      pick("BETTER_AUTH_SECRET"),
      "BETTER_AUTH_SECRET",
      "Must be IDENTICAL on cod-server (shared auth database).",
    ),
    MCP_LOGIN_TICKET_SECRET: pick("MCP_LOGIN_TICKET_SECRET"),
  };
}

/** Retired Vercel entry — kept so existing imports keep compiling. */
export function buildAuthEnvFromProcessEnv(): AuthEnv {
  throw new Error("buildAuthEnvFromProcessEnv is retired — pass the worker env to buildAuthEnv instead.");
}

// One instance per request — never a module singleton. D1 short-lived query
// handles are created per call, so this is strictly request-scoped.
export function createAuth(env: AuthEnv) {
  const db = drizzle(env.DB, { schema });

  const kv = env.RATE_LIMIT_KV;
  const secondaryStorage = {
    get: (key: string) => kv.get(key),
    getAndDelete: async (key: string) => {
      const value = await kv.get(key);
      await kv.delete(key);
      return value;
    },
    set: (key: string, value: string, ttl?: number) =>
      kv.put(key, value, ttl ? { expirationTtl: Math.max(60, Math.ceil(ttl)) } : undefined),
    delete: (key: string) => kv.delete(key).then(() => {}),
    // KV has no atomic increment — read-modify-write. Approximate, which is
    // all rate limiting needs; matches the pre-migration CF behavior.
    increment: async (key: string, ttl?: number): Promise<number> => {
      const current = Number((await kv.get(key)) ?? 0);
      const next = (Number.isFinite(current) ? current : 0) + 1;
      await kv.put(key, String(next), { expirationTtl: Math.max(60, Math.ceil(ttl ?? 60)) });
      return next;
    },
  };

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
      usePlural: true,
    }),
    baseURL: env.PUBLIC_APP_URL,
    secret: env.BETTER_AUTH_SECRET,
    secondaryStorage,
    trustedOrigins: [
      ...(import.meta.env.DEV ? ["http://localhost:4321"] : []),
      ...(env.PUBLIC_TRUSTED_ORIGINS ?? "")
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean),
    ],
    disabledPaths: ["/token"],
    session: {
      storeSessionInDatabase: true,
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60,
      },
    },
    advanced: {
      ipAddress: {
        ipAddressHeaders: ["x-forwarded-for"],
      },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: {
        "/request-password-reset": { window: 3600, max: 3 },
        "/sign-in/magic-link": { window: 3600, max: 5 },
      },
    },
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      // No self-service registration: accounts are provisioned by an admin.
      disableSignUp: true,
      /**
       * Password-reset email via the shared Sendili send path.
       *
       * Security contract: this callback runs only for users that exist,
       * while better-auth answers unknown emails with the same generic
       * "check your email" response — so the callback must never throw
       * or change observable behavior (no enumeration). Every failure is
       * caught here, logged with its stable code, and swallowed.
       * Residual risk (accepted): the provider round-trip adds latency
       * only for existing emails — a timing side channel mitigated by the
       * 3/hour rate limit on /request-password-reset.
       */
      sendResetPassword: async ({ user, url, token }) => {
        try {
          const store = await getStore(db);
          const language = (user as { language?: string }).language === "ar" ? "ar" : "en";
          const email = renderPasswordResetEmail({
            storeName: store?.name ?? "CodFlow",
            userName: user.name,
            resetUrl: url,
            language,
          });
          const outcome = await sendTransactionalEmail(db, {
            to: user.email,
            subject: email.subject,
            html: email.html,
            text: email.text,
            idempotencyKey: `reset-${user.id}-${token.slice(0, 12)}`,
          });
          if (!outcome.sent && outcome.error) {
            console.error("[auth] password-reset email failed:", outcome.error);
          }
        } catch (err) {
          console.error("[auth] password-reset email error:", err);
        }
      },
    },
    user: {
      additionalFields: {
        /**
         * Privileged fields are `input: false` — better-auth's
         * session-authenticated /update-user must never accept them, or
         * any staff member could self-promote (`{role:"admin"}` was
         * accepted before this). Admin-side changes go through
         * cod-server's PATCH /api/users/:id, which writes the database directly.
         */
        role:     { type: "string", defaultValue: "staff",  required: false, input: false },
        status:   { type: "string", defaultValue: "active", required: false, input: false },
        apiKey:   { type: "string", required: false, input: false },
        /** Email language preference — the one field users may self-edit. */
        language: { type: "string", defaultValue: "en", required: false },
      },
    },
    plugins: [
      // Attaches real scopes (user_scopes join) to every session response so
      // the Identity contract is truthful end-to-end. Not added to the JWT
      // payload — scopes stay server-resolved per request.
      customSession(async ({ user, session }) => {
        const rows = await db
          .select({ scope: userScopes.scope })
          .from(userScopes)
          .where(eq(userScopes.userId, user.id));

        // Strip sensitive fields from user object before sending to browser
        const { apiKey, ...safeUser } = user as typeof user & { apiKey?: string };

        return {
          user: safeUser,
          session,
          scopes: (user as { role?: string }).role === "admin"
            ? ["*"]
            : rows.map((r) => r.scope),
        };
      }),
      jwt({
        jwt: {
          // Tokens are issued FOR the API resource, matching cod-server's
          // sessionAuth audience check (docs: "Modify Issuer, Audience…").
          audience: env.PUBLIC_API_URL,
          // Default payload embeds the ENTIRE user row — including the
          // plaintext apiKey additionalField. Whitelist instead.
          definePayload: ({ user }) => ({
            id: user.id,
            email: user.email,
            role: (user as { role?: string }).role ?? "staff",
          }),
        },
      }),
    ],
  });
}
