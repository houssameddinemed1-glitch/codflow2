import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Search } from "lucide-react";
import { canScope, RequireAuth, useIdentity } from "@/features/auth/components/RequireAuth";
import { DashboardChrome } from "@/components/layout/chrome";
import { Alert, PageHeader, Skeleton } from "@/components/ui";
import { useLocale, useT } from "@/i18n/react";
import { SCOPES } from "../../../../../cod-shared/rbac/scopes";
import { listProducts } from "@/features/products/api";
import { formatMoneyValue } from "@/features/products/model";
import type { Product } from "@/features/products/types";
import { createLandingPage } from "@/features/landing-pages/api";
import { landingPageErrorMessage } from "@/features/landing-pages/model";
import { notify } from "@/lib/notify";

function Gated() {
  const t = useT("landing-pages");
  const common = useT("common");
  const locale = useLocale();
  const auth = useT("auth");
  const identity = useIdentity();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [query, setQuery] = useState("");
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [mode, setMode] = useState<"single" | "multi">("single");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [creatingMulti, setCreatingMulti] = useState(false);

  const canManage = canScope(identity, SCOPES.LANDING_PAGES_MANAGE);

  async function load() {
    setLoadError(null);
    try {
      setProducts((await listProducts({ limit: 100 })).data);
    } catch (cause) {
      setLoadError(cause);
    }
  }

  useEffect(() => {
    if (canScope(identity, SCOPES.LANDING_PAGES_READ)) void load();
  }, [identity?.role, identity?.scopes.join(",")]);

  if (!canManage)
    return (
      <Alert role="alert" tone="critical">
        {auth("no_access")}
      </Alert>
    );

  if (loadError)
    return (
      <Alert role="alert" tone="critical">
        <ArrowLeft size={18} className="shrink-0" />
        <div className="flex-1">
          <p className="font-semibold">{t("error_generic")}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 text-xs font-semibold underline underline-offset-4"
          >
            {common("retry")}
          </button>
        </div>
      </Alert>
    );

  async function onPick(product: Product) {
    if (creatingId) return;
    setCreatingId(product.id);
    setActionError(null);
    try {
      const created = await createLandingPage({
        name: product.name,
        productId: product.id,
      });
      window.location.assign(
        `/landing-pages/${encodeURIComponent(created.data.id)}/studio`,
      );
    } catch (cause) {
      const message = landingPageErrorMessage(cause, t);
      setActionError(message);
      notify.error(message);
      setCreatingId(null);
    }
  }

  const q = query.trim().toLocaleLowerCase();
  const visible = (products ?? []).filter(
    (product) =>
      !q ||
      `${product.name} ${product.sku ?? ""}`.toLocaleLowerCase().indexOf(q) !== -1,
  );

  function toggleSelect(productId: string) {
    setSelectedIds((prev) =>
      prev.includes(productId) ? prev.filter((id) => id !== productId) : [...prev, productId],
    );
  }

  async function onCreateMulti() {
    if (creatingMulti || creatingId) return;
    const picks = selectedIds
      .map((id) => (products ?? []).find((p) => p.id === id))
      .filter((p): p is Product => Boolean(p));
    if (picks.length < 2) {
      const message = t("new.error_min_two");
      setActionError(message);
      notify.error(message);
      return;
    }
    setCreatingMulti(true);
    setActionError(null);
    try {
      const created = await createLandingPage({
        name: picks[0].name,
        productId: picks[0].id,
        kind: "multi",
        productIds: picks.map((p) => p.id),
      });
      window.location.assign(
        `/landing-pages/${encodeURIComponent(created.data.id)}/studio`,
      );
    } catch (cause) {
      const message = landingPageErrorMessage(cause, t);
      setActionError(message);
      notify.error(message);
      setCreatingMulti(false);
    }
  }

  return (
    <div className="space-y-4">
      {actionError && (
        <Alert role="alert" tone="critical">
          <span className="flex-1">{actionError}</span>
        </Alert>
      )}
      <div className="flex gap-2" role="tablist" aria-label={t("new.title")}>
        {(["single", "multi"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`h-9 flex-1 rounded-xl border text-sm font-bold transition ${
              mode === m
                ? "border-brand bg-brand/10 text-brand"
                : "border-border bg-card text-muted-foreground"
            }`}
          >
            {t(m === "single" ? "new.mode_single" : "new.mode_multi")}
          </button>
        ))}
      </div>
      {mode === "multi" && (
        <p className="text-xs text-muted-foreground">{t("new.multi_hint")}</p>
      )}
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder={t("new.search_placeholder")}
          className="h-10 w-full rounded-xl border border-border bg-background ps-9 pe-3 text-sm"
        />
      </div>
      {products === null ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : (
      <>
      {mode === "multi" && (
        <div className="grid gap-3 sm:grid-cols-2">
          {visible.map((product) => {
            const selected = selectedIds.includes(product.id);
            const order = selected ? selectedIds.indexOf(product.id) + 1 : null;
            return (
              <button
                key={product.id}
                type="button"
                disabled={creatingMulti}
                onClick={() => toggleSelect(product.id)}
                aria-pressed={selected}
                className={`flex items-center gap-3 rounded-xl border bg-card p-3 text-start transition disabled:opacity-60 ${
                  selected ? "border-brand ring-1 ring-brand/40" : "border-border hover:border-brand/40"
                }`}
              >
                <span
                  className={`flex size-6 shrink-0 items-center justify-center rounded-md border text-xs font-black ${
                    selected ? "border-brand bg-brand text-white" : "border-border text-transparent"
                  }`}
                >
                  {order ?? "✓"}
                </span>
                {product.images?.[0]?.src ? (
                  <img
                    src={product.images[0].src}
                    alt={product.name}
                    className="size-14 shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <span className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-muted text-xs text-muted-foreground">
                    —
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{product.name}</span>
                  <span className="mt-0.5 block text-sm tabular-nums text-muted-foreground">
                    {formatMoneyValue(product.price, locale)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
      {mode === "multi" && visible.length > 0 && (
        <div className="sticky bottom-4 flex items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-lg">
          <span className="flex-1 text-sm font-semibold">
            {t("new.selected_count").replace("{n}", String(selectedIds.length))}
          </span>
          <button
            type="button"
            disabled={creatingMulti || selectedIds.length < 2}
            onClick={() => void onCreateMulti()}
            className="flex h-10 items-center gap-2 rounded-xl bg-brand px-5 text-sm font-black text-white transition disabled:opacity-50"
          >
            {creatingMulti && <Loader2 size={16} className="animate-spin" />}
            {t("new.create_multi")}
          </button>
        </div>
      )}
      {mode === "multi" && visible.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">{t("new.empty")}</p>
      )}
      {mode === "single" && (visible.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t("new.empty")}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {visible.map((product) => (
            <button
              key={product.id}
              type="button"
              disabled={creatingId !== null}
              onClick={() => void onPick(product)}
              className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 text-start transition hover:border-brand/40 disabled:opacity-60"
            >
              {product.images?.[0]?.src ? (
                <img
                  src={product.images[0].src}
                  alt={product.name}
                  className="size-14 shrink-0 rounded-lg object-cover"
                />
              ) : (
                <span className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-muted text-xs text-muted-foreground">
                  —
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{product.name}</span>
                <span className="mt-0.5 block text-sm tabular-nums text-muted-foreground">
                  {formatMoneyValue(product.price, locale)}
                </span>
              </span>
              {creatingId === product.id ? (
                <Loader2 size={18} className="me-2 animate-spin text-brand" />
              ) : (
                <span className="me-2 text-xs font-bold text-brand">{t("new.pick")}</span>
              )}
            </button>
          ))}
        </div>
      ))}
      </>
      )}
    </div>
  );
}

export default function LandingPageNewPageApp() {
  const t = useT("landing-pages");
  return (
    <RequireAuth>
      <DashboardChrome currentPath="/landing-pages">
        <PageHeader
          title={t("new.title")}
          subtitle={t("new.subtitle")}
          backHref="/landing-pages"
          backLabel={t("page_title")}
        />
        <Gated />
      </DashboardChrome>
    </RequireAuth>
  );
}
