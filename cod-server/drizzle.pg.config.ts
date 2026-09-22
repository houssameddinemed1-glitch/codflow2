import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "../cod-shared/db/schema.pg.ts",
  out: "./src/db/migrations-pg",
  dialect: "postgresql",
});
