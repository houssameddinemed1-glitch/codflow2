/**
 * Minimal type shim for Cloudflare Workflows runtime modules.
 *
 * `tsc --noEmit` runs without the Workers runtime (tsconfig `types: []` and
 * the three workflow entry files are excluded from the program). The workflow
 * classes must still be re-exported from `src/index.ts` so `wrangler deploy`
 * sees them for `[[workflows]]` bindings — that re-export pulls the files
 * back into the tsc program, where `cloudflare:workers` / `cloudflare:workflows`
 * would otherwise be unresolvable (TS2307) and `this.env` unknown (TS2339).
 *
 * Wrangler provides the real modules at build/deploy time; this shim only
 * exists so `npm run typecheck` stays green. Keep it minimal — full step
 * semantics are validated by `vitest` (run-*.ts ports) and `wrangler deploy`.
 */
declare module "cloudflare:workers" {
  export interface WorkflowEvent<TParams = unknown> {
    payload: TParams;
    instanceId: string;
  }
  export interface WorkflowStep {
    do<T>(name: string, callback: () => Promise<T>): Promise<T>;
    do<T>(
      name: string,
      config: { retries?: { limit: number; delay?: string; backoff?: string }; timeout?: string },
      callback: () => Promise<T>,
    ): Promise<T>;
  }
  export abstract class WorkflowEntrypoint<TEnv = any, TParams = unknown> {
    protected env: TEnv;
    abstract run(event: WorkflowEvent<TParams>, step: WorkflowStep): Promise<unknown>;
  }
}

declare module "cloudflare:workflows" {
  export class NonRetryableError extends Error {}
}
