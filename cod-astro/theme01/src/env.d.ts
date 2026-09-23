/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

// Vercel runtime: server secrets come from astro:env/server, backed by plain
// environment variables (see astro.config.mjs env.schema). No worker bindings.

interface SelectOption {
  value: string;
  label: string;
}

interface Window {
  __selectSetLoading: (id: string, loading: boolean, loadingText: string) => void;
  __selectPopulate: (id: string, options: SelectOption[], placeholder: string) => void;
  __selectSetDisabled: (id: string, disabledText: string) => void;
}
