import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Filter,
  PackageOpen,
  PackageSearch,
  RefreshCw,
  RotateCcw,
  Truck,
} from "lucide-react";
import {
  canScope,
  RequireAuth,
  useIdentity,
} from "@/features/auth/components/RequireAuth";
import { DashboardChrome } from "@/components/layout/chrome";
import { useLocale, useT } from "@/i18n/react";
import { ApiError } from "@/lib/api";
import { notify } from "@/lib/notify";
import {
  getTracking,
  listDeliveryCompanies,
  listOrders,
} from "@/features/orders/api";
import { OrderStatusBadge } from "@/features/orders/components/OrderStatusBadge";
import {
  Alert,
  Card,
  EmptyState,
  LinkButton,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui";
import type {
  DeliveryCompany,
  OrderListItem,
} from "@/features/orders/types";
import {
  countTrackingGroups,
  EMPTY_TRACKING_FILTERS,
  filterTrackingOrders,
  TRACKING_DOT_CLASS,
  TRACKING_ROW_CLASS,
  trackingRowTone,
  type TrackingFilters,
  type TrackingGroup,
} from "@/features/tracking/model";

interface CarrierEvent {
  activity: string;
  description?: string;
  date?: string;
}

const GROUP_FILTERS: Array<"all" | TrackingGroup> = [
  "all",
  "in_transit",
  "delivered",
  "returned",
];

const GROUP_PILL_CLASS: Record<"all" | TrackingGroup, string> = {
  all: "border-border bg-card text-muted-foreground hover:text-foreground data-[active=true]:border-primary data-[active=true]:bg-primary data-[active=true]:text-primary-foreground",
  in_transit:
    "border-amber-500/30 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 data-[active=true]:bg-amber-500 data-[active=true]:text-white dark:text-amber-300 dark:data-[active=true]:text-white",
  delivered:
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 data-[active=true]:bg-emerald-500 data-[active=true]:text-white dark:text-emerald-300 dark:data-[active=true]:text-white",
  returned:
    "border-red-500/30 bg-red-500/10 text-red-700 hover:bg-red-500/20 data-[active=true]:bg-red-500 data-[active=true]:text-white dark:text-red-300 dark:data-[active=true]:text-white",
};

function formatDateTime(value: string | null | undefined, locale: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(locale === "ar" ? "ar-DZ" : `${locale}-DZ`, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function companyName(
  companyId: string | null,
  companies: DeliveryCompany[],
  locale: string,
): string {
  if (!companyId) return "-";
  const found = companies.find((c) => c.id === companyId);
  if (!found) return companyId.slice(0, 8);
  return locale === "ar" ? found.nameAr || found.name : found.name;
}

function TrackingBoard() {
  const t = useT("orders");
  const common = useT("common");
  const auth = useT("auth");
  const locale = useLocale();
  const identity = useIdentity();
  const [orders, setOrders] = useState<OrderListItem[] | null>(null);
  const [companies, setCompanies] = useState<DeliveryCompany[]>([]);
  const [loadError, setLoadError] = useState<ApiError | Error | null>(null);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [filters, setFilters] = useState<TrackingFilters>(EMPTY_TRACKING_FILTERS);
  const [page, setPage] = useState(1);
  const [events, setEvents] = useState<Record<string, CarrierEvent[]>>({});
  const [loadingEvents, setLoadingEvents] = useState<Set<string>>(new Set());
  const deferredFilters = useDeferredValue(filters);
  const pageSize = 100;

  async function load() {
    if (!canScope(identity, "orders:read")) return;
    setLoadError(null);
    try {
      const mayReadDelivery = canScope(identity, "delivery:read");
      const [orderResponse, companyResponse] = await Promise.all([
        listOrders({ limit: 100, offset: 0 }),
        mayReadDelivery
          ? listDeliveryCompanies(true).catch(() => [])
          : Promise.resolve([]),
      ]);
      setOrders(orderResponse.data ?? []);
      setCompanies(companyResponse);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause : new Error(String(cause)));
    }
  }

  useEffect(() => {
    void load();
  }, [identity?.role, identity?.scopes.join(",")]);

  useEffect(() => {
    setPage(1);
  }, [deferredFilters]);

  const counts = useMemo(
    () => countTrackingGroups(orders ?? []),
    [orders],
  );
  const filtered = useMemo(
    () => filterTrackingOrders(orders ?? [], deferredFilters),
    [orders, deferredFilters],
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const wilayas = useMemo(
    () =>
      [...new Set((orders ?? []).map((o) => o.wilaya).filter(Boolean))] as string[],
    [orders],
  );
  const hasFilters = Object.values(filters).some(
    (value) => value !== "all" && value !== "",
  );

  function setFilter(key: keyof TrackingFilters, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  async function refreshAll() {
    if (refreshingAll) return;
    setRefreshingAll(true);
    try {
      await load();
    } finally {
      setRefreshingAll(false);
    }
  }

  async function refreshOne(order: OrderListItem) {
    if (loadingEvents.has(order.id)) return;
    setLoadingEvents((current) => new Set(current).add(order.id));
    try {
      const data = (await getTracking(order.id)) as unknown as CarrierEvent[];
      setEvents((current) => ({ ...current, [order.id]: data ?? [] }));
      notify.success(String(t("tracking.row.tracking_refreshed")));
    } catch (cause) {
      notify.error(
        cause instanceof Error
          ? cause.message
          : String(t("tracking.row.tracking_failed")),
      );
    } finally {
      setLoadingEvents((current) => {
        const next = new Set(current);
        next.delete(order.id);
        return next;
      });
    }
  }

  if (!canScope(identity, "orders:read")) {
    return (
      <DashboardChrome currentPath="/tracking">
        <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {auth("no_access")}
        </p>
      </DashboardChrome>
    );
  }

  if (loadError) {
    return (
      <DashboardChrome currentPath="/tracking">
        <Alert role="alert" tone="critical">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">{t("tracking.load_error")}</p>
            <p className="mt-1 text-xs opacity-80">{loadError.message}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-3 text-xs font-semibold underline underline-offset-4"
            >
              {common("retry")}
            </button>
          </div>
        </Alert>
      </DashboardChrome>
    );
  }

  const stats = [
    {
      key: "total",
      label: String(t("tracking.stats.total")),
      value: counts.total,
      icon: <PackageSearch size={18} />,
      classes: "border-s-primary bg-primary/5",
    },
    {
      key: "in_transit",
      label: String(t("tracking.stats.in_transit")),
      value: counts.in_transit,
      icon: <Truck size={18} />,
      classes: "border-s-amber-500 bg-amber-500/10",
    },
    {
      key: "delivered",
      label: String(t("tracking.stats.delivered")),
      value: counts.delivered,
      icon: <CheckCircle2 size={18} />,
      classes: "border-s-emerald-500 bg-emerald-500/10",
    },
    {
      key: "returned",
      label: String(t("tracking.stats.returned")),
      value: counts.returned,
      icon: <RotateCcw size={18} />,
      classes: "border-s-red-500 bg-red-500/10",
    },
  ];

  return (
    <DashboardChrome currentPath="/tracking">
      <PageHeader
        title={t("tracking.title")}
        subtitle={t("tracking.subtitle")}
        actions={
          <button
            type="button"
            onClick={() => void refreshAll()}
            disabled={refreshingAll || orders === null}
            className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            <RefreshCw
              size={16}
              className={refreshingAll ? "animate-spin" : undefined}
            />
            <span>
              {refreshingAll ? t("tracking.refreshing") : t("tracking.refresh_all")}
            </span>
          </button>
        }
      />

      {orders === null ? (
        <div
          role="status"
          aria-busy="true"
          className="overflow-hidden rounded-xl border border-border bg-card"
        >
          <div className="h-14 border-b border-border bg-muted/35" />
          {Array.from({ length: 7 }).map((_, index) => (
            <div
              key={index}
              className="grid h-14 grid-cols-[1fr_1.2fr_0.8fr] items-center gap-4 border-b border-border px-4 last:border-0"
            >
              <div className="h-3 w-24 animate-pulse rounded bg-muted" />
              <div className="h-3 w-32 animate-pulse rounded bg-muted" />
              <span className="h-6 w-20 justify-self-end animate-pulse rounded-full bg-muted" />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {stats.map((stat) => (
              <div
                key={stat.key}
                className={`rounded-xl border border-border border-s-4 bg-card p-3 shadow-2xs ${stat.classes}`}
              >
                <div className="flex items-center gap-2 text-muted-foreground">
                  {stat.icon}
                  <span className="text-xs font-semibold">{stat.label}</span>
                </div>
                <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
                  {stat.value}
                </p>
              </div>
            ))}
          </div>

          <Card flush>
            <div className="space-y-3 border-b border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                {GROUP_FILTERS.map((group) => (
                  <button
                    key={group}
                    type="button"
                    data-active={filters.group === group}
                    onClick={() => setFilter("group", group)}
                    className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3.5 text-[13px] font-semibold transition-colors ${GROUP_PILL_CLASS[group]}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`size-2 rounded-full ${group === "all" ? "bg-current" : TRACKING_DOT_CLASS[group === "in_transit" ? "transit" : group]}`}
                    />
                    {t(`tracking.status_groups.${group}`)}
                    <span className="tabular-nums opacity-75">
                      {group === "all"
                        ? counts.total
                        : counts[group as TrackingGroup]}
                    </span>
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <SearchInput
                  value={filters.query}
                  onChange={(query) => setFilter("query", query)}
                  placeholder={String(t("tracking.search_placeholder"))}
                />
                <span className="shrink-0 text-xs font-medium text-muted-foreground">
                  {t("tracking.count_label").replace("{count}", String(filtered.length))}
                </span>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {companies.length > 0 && (
                  <label className="relative flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-input bg-background px-3 sm:flex-none">
                    <Filter
                      size={14}
                      aria-hidden="true"
                      className="shrink-0 text-muted-foreground"
                    />
                    <Select
                      aria-label={String(t("tracking.filter.company"))}
                      value={filters.company}
                      onChange={(event) =>
                        setFilter("company", event.currentTarget.value)
                      }
                      variant="bare"
                      size="sm"
                      wrapperClassName="min-w-0 flex-1"
                      triggerClassName="min-w-0 flex-1"
                    >
                      <option value="all">{t("tracking.filter.all_companies")}</option>
                      {companies.map((company) => (
                        <option key={company.id} value={company.id}>
                          {locale === "ar"
                            ? company.nameAr || company.name
                            : company.name}
                        </option>
                      ))}
                    </Select>
                  </label>
                )}
                {wilayas.length > 1 && (
                  <label className="relative flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-input bg-background px-3 sm:flex-none">
                    <Filter
                      size={14}
                      aria-hidden="true"
                      className="shrink-0 text-muted-foreground"
                    />
                    <Select
                      aria-label={String(t("table.wilaya"))}
                      value={filters.wilaya}
                      onChange={(event) =>
                        setFilter("wilaya", event.currentTarget.value)
                      }
                      variant="bare"
                      size="sm"
                      wrapperClassName="min-w-0 flex-1"
                      triggerClassName="min-w-0 flex-1"
                    >
                      <option value="all">{t("filters.all_wilayas")}</option>
                      {wilayas.map((wilaya) => (
                        <option key={wilaya} value={wilaya}>
                          {wilaya}
                        </option>
                      ))}
                    </Select>
                  </label>
                )}
                {hasFilters && (
                  <button
                    type="button"
                    onClick={() => setFilters(EMPTY_TRACKING_FILTERS)}
                    className="h-10 rounded-lg px-3 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {common("cancel")}
                  </button>
                )}
              </div>
            </div>

            {filtered.length === 0 ? (
              <EmptyState
                icon={<PackageOpen size={22} />}
                title={
                  hasFilters
                    ? common("no_results_found")
                    : t("tracking.empty.title")
                }
                description={hasFilters ? undefined : t("tracking.empty.description")}
              />
            ) : (
              <>
                <div className="divide-y divide-border md:hidden">
                  {visible.map((order) => {
                    const tone = trackingRowTone(order.status);
                    const orderEvents = events[order.id];
                    const lastEvent = orderEvents?.[orderEvents.length - 1];
                    const refreshing = loadingEvents.has(order.id);
                    return (
                      <article
                        key={order.id}
                        className={`border-s-4 p-4 transition-colors ${TRACKING_ROW_CLASS[tone]}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <a
                            href={`/orders/${order.id}`}
                            className="font-semibold text-link underline-offset-4 hover:underline"
                          >
                            {order.orderNumber}
                          </a>
                          <OrderStatusBadge status={order.status} />
                        </div>
                        <p className="mt-1 text-sm font-medium text-foreground">
                          {order.customerName}
                          <span
                            dir="ltr"
                            className="ms-2 text-xs text-muted-foreground"
                          >
                            {order.phone}
                          </span>
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {order.wilaya}
                          {order.commune ? ` · ${order.commune}` : ""} ·{" "}
                          {companyName(order.companyId, companies, locale)}
                        </p>
                        <p
                          dir="ltr"
                          className="mt-1 text-start font-mono text-xs font-semibold text-foreground"
                        >
                          {order.trackingNumber}
                        </p>
                        <p className="mt-1.5 rounded-lg border border-border/60 bg-background/60 px-2 py-1.5 text-xs text-muted-foreground">
                          <span className="mb-0.5 block text-[10.5px] font-bold opacity-70">
                            {t("tracking.table.carrier_update")}
                          </span>
                          {refreshing
                            ? t("tracking.refreshing")
                            : lastEvent
                              ? `${lastEvent.activity}${lastEvent.date ? ` · ${formatDateTime(lastEvent.date, locale)}` : ""}`
                              : orderEvents
                                ? t("tracking.row.no_tracking_events")
                                : t(`status.${order.status}`)}
                        </p>
                        <div className="mt-2 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void refreshOne(order)}
                            disabled={refreshing}
                            className="inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-input bg-background px-3 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-60"
                          >
                            <RefreshCw
                              size={13}
                              className={refreshing ? "animate-spin" : undefined}
                            />
                            {t("tracking.row.refresh_tracking")}
                          </button>
                          <LinkButton href={`/orders/${order.id}`} size="sm">
                            {t("tracking.row.view_details")}
                          </LinkButton>
                        </div>
                      </article>
                    );
                  })}
                </div>

                <div className="hidden overflow-x-auto md:block">
                  <Table className="min-w-[1080px]">
                    <TableHeader>
                      <TableRow className="text-xs font-semibold text-muted-foreground">
                        <TableHead className="text-start">
                          {t("tracking.table.order")}
                        </TableHead>
                        <TableHead className="text-start">
                          {t("tracking.table.customer")}
                        </TableHead>
                        <TableHead className="text-start">
                          {t("tracking.table.wilaya")}
                        </TableHead>
                        <TableHead className="text-start">
                          {t("tracking.table.company")}
                        </TableHead>
                        <TableHead className="text-start">
                          {t("tracking.table.tracking_number")}
                        </TableHead>
                        <TableHead className="text-start">
                          {t("tracking.table.carrier_update")}
                        </TableHead>
                        <TableHead className="text-start">
                          {t("tracking.table.status")}
                        </TableHead>
                        <TableHead className="text-start">
                          <span className="sr-only">{common("table.actions")}</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visible.map((order) => {
                        const tone = trackingRowTone(order.status);
                        const orderEvents = events[order.id];
                        const lastEvent =
                          orderEvents?.[orderEvents.length - 1];
                        const refreshing = loadingEvents.has(order.id);
                        return (
                          <TableRow
                            key={order.id}
                            className={`border-s-4 transition-colors ${TRACKING_ROW_CLASS[tone]}`}
                          >
                            <TableCell>
                              <a
                                href={`/orders/${order.id}`}
                                className="font-semibold text-link underline-offset-4 hover:underline"
                              >
                                {order.orderNumber}
                              </a>
                              <p className="mt-0.5 text-[11px] text-muted-foreground">
                                {formatDateTime(order.updatedAt, locale)}
                              </p>
                            </TableCell>
                            <TableCell>
                              <p className="font-medium text-foreground">
                                {order.customerName}
                              </p>
                              <p dir="ltr" className="text-start text-xs text-muted-foreground">
                                {order.phone}
                              </p>
                            </TableCell>
                            <TableCell>
                              <span className="text-xs font-medium">
                                {order.wilaya ?? "-"}
                                {order.commune ? ` · ${order.commune}` : ""}
                              </span>
                            </TableCell>
                            <TableCell>
                              <span className="text-xs font-medium">
                                {companyName(order.companyId, companies, locale)}
                              </span>
                            </TableCell>
                            <TableCell>
                              <span
                                dir="ltr"
                                className="inline-block rounded-md border border-border/70 bg-background/70 px-1.5 py-0.5 font-mono text-[11px] font-semibold"
                              >
                                {order.trackingNumber}
                              </span>
                            </TableCell>
                            <TableCell className="max-w-56">
                              {refreshing ? (
                                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                                  <RefreshCw size={13} className="animate-spin" />
                                  {t("tracking.refreshing")}
                                </span>
                              ) : lastEvent ? (
                                <span>
                                  <span className="block max-w-52 truncate text-xs font-semibold text-foreground" title={lastEvent.activity}>
                                    {lastEvent.activity}
                                  </span>
                                  <span className="block text-[11px] text-muted-foreground">
                                    {lastEvent.description ?? t("tracking.row.last_event")}
                                    {lastEvent.date
                                      ? ` · ${formatDateTime(lastEvent.date, locale)}`
                                      : ""}
                                  </span>
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  {orderEvents
                                    ? t("tracking.row.no_tracking_events")
                                    : "-"}
                                </span>
                              )}
                            </TableCell>
                            <TableCell>
                              <OrderStatusBadge status={order.status} />
                            </TableCell>
                            <TableCell className="text-end">
                              <span className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  title={String(t("tracking.row.refresh_tracking"))}
                                  aria-label={`${t("tracking.row.refresh_tracking")} ${order.orderNumber}`}
                                  onClick={() => void refreshOne(order)}
                                  disabled={refreshing}
                                  className="grid size-8 place-items-center rounded-lg border border-input bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
                                >
                                  <RefreshCw
                                    size={14}
                                    className={refreshing ? "animate-spin" : undefined}
                                  />
                                </button>
                                <a
                                  href={`/orders/${order.id}`}
                                  title={String(t("tracking.row.view_details"))}
                                  aria-label={`${t("tracking.row.view_details")} ${order.orderNumber}`}
                                  className="grid size-8 place-items-center rounded-lg border border-input bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                >
                                  <PackageOpen size={14} />
                                </a>
                              </span>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                <Pagination
                  page={safePage}
                  totalPages={totalPages}
                  total={filtered.length}
                  pageSize={pageSize}
                  onPageChange={setPage}
                />
              </>
            )}
          </Card>
        </div>
      )}
    </DashboardChrome>
  );
}

export default function TrackingPageApp() {
  return (
    <RequireAuth>
      <TrackingBoard />
    </RequireAuth>
  );
}
