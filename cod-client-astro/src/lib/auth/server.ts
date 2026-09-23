import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { customSession, jwt } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { Redis } from "@upstash/redis";
import * as schema from "../../../../cod-shared/db/schema.pg";
import { userScopes } from "../../../../cod-shared/db/schema.pg";
import { getStore } from "../../../../cod-shared/queries/stores";
import { renderPasswordResetEmail } from "../../../../cod-shared/lib/email-templates";
import { sendTransactionalEmail } from "../../../../cod-shared/lib/transactional-email";
import { eq } from "drizzle-orm";

export interface AuthEnv {
  /** Neon Postgres connection string (shared auth database with cod-server). */
  DATABASE_URL: string;
  /** Upstash Redis REST credentials (rate-limit + session secondary storage). */
  UPSTASH_REDIS_REST_URL: string;
  UPSTASH_REDIS_REST_TOKEN: string;
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

/** Build the AuthEnv from process.env (Vercel runtime vars). Throws when required vars are missing. */
export function buildAuthEnvFromProcessEnv(): AuthEnv {
  const pick = (name: string): string | undefined => {
    const v = process.env[name];
    return v && v.length > 0 ? v : undefined;
  };
  const required = (
    value: string | undefined,
    name: string,
    hint: string,
  ): string => {
    if (!value) {
      throw new Error(
        `Auth misconfigured: ${name} is not set. ${hint}`,
      );
    }
    return value;
  };
  return {
    DATABASE_URL: required(
      pick("DATABASE_URL"),
      "DATABASE_URL",
      "Connect Neon Postgres (or set DATABASE_URL).",
    ),
    UPSTASH_REDIS_REST_URL: required(
      pick("UPSTASH_REDIS_REST_URL") ?? pick("KV_REST_API_URL"),
      "UPSTASH_REDIS_REST_URL",
      "Connect Upstash Redis (KV_REST_API_URL also accepted).",
    ),
    UPSTASH_REDIS_REST_TOKEN: required(
      pick("UPSTASH_REDIS_REST_TOKEN") ?? pick("KV_REST_API_TOKEN"),
      "UPSTASH_REDIS_REST_TOKEN",
      "Connect Upstash Redis (KV_REST_API_TOKEN also accepted).",
    ),
    PUBLIC_APP_URL: required(
      pick("PUBLIC_APP_URL"),
      "PUBLIC_APP_URL",
      "Set the dashboard's public origin.",
    ),
    PUBLIC_API_URL: required(
      pick("PUBLIC_API_URL"),
      "PUBLIC_API_URL",
      "Set the API origin (build-time PUBLIC_API_URL should match).",
    ),
    PUBLIC_TRUSTED_ORIGINS: pick("PUBLIC_TRUSTED_ORIGINS"),
    BETTER_AUTH_SECRET: required(
      pick("BETTER_AUTH_SECRET"),
      "BETTER_AUTH_SECRET",
      "Must be IDENTICAL on cod-server (shared auth database).",
    ),
    MCP_LOGIN_TICKET_SECRET: pick("MCP_LOGIN_TICKET_SECRET"),
  };
}

// One instance per request — never a module singleton. Neon HTTP is stateless
// per query, so this is strictly safer than the old shared-D1 pattern.
export function createAuth(env: AuthEnv) {
  const sql = neon(env.DATABASE_URL);
  const db = drizzle(sql, { schema });

  const redis = new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  });
  const secondaryStorage = {
    get: (key: string) => redis.get<string>(key),
    getAndDelete: async (key: string) => {
      const value = await redis.get<string>(key);
      await redis.del(key);
      return value;
    },
    set: (key: string, value: string, ttl?: number) =>
      ttl
        ? redis.set(key, value, { ex: Math.max(60, Math.ceil(ttl)) })
        : redis.set(key, value),
    delete: (key: string) => redis.del(key).then(() => {}),
    increment: async (key: string, ttl?: number): Promise<number> => {
      const next = await redis.incr(key);
      if (next === 1) {
        await redis.expire(key, Math.max(60, Math.ceil(ttl ?? 60)));
      }
      return next;
    },
  };

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",
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
