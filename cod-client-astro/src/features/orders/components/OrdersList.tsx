import { useDeferredValue, useEffect, useState } from "react";
import { AlertCircle, Building2, Filter, PackageOpen, Trash2, X } from "lucide-react";
import { canScope, useIdentity } from "@/features/auth/components/RequireAuth";
import { useT } from "@/i18n/react";
import { ApiError } from "@/lib/api";
import { notify } from "@/lib/notify";
import {
  bulkDeleteOrders,
  bulkDispatchOrders,
  listDeliveryCompanies,
  listDrivers,
  listOrders,
  listProducts,
} from "@/features/orders/api";
import {
  canDispatchOrder,
  FILTER_STATUSES,
  filterOrders,
  paginateOrders,
  sortOrders,
  type OrderFilters,
  type OrderSortKey,
} from "@/features/orders/model";
import type {
  DeliveryCompany,
  Driver,
  OrderListItem,
  Product,
} from "@/features/orders/types";
import {
  Button,
  Dialog,
  EmptyState,
  LinkButton,
  Alert,
  Card,
  Pagination,
  SearchInput,
  Select,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  SortHeader,
  useConfirmDialog,
} from "@/components/ui";
import { OrderDesktopRow, OrderMobileCard } from "@/features/orders/components/OrderRow";

const EMPTY_FILTERS: OrderFilters = {
  query: "",
  status: "all",
  delivery: "all",
  wilaya: "all",
  type: "all",
  product: "all",
};

function OrderSkeleton() {
  return (
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
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="relative flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-input bg-background px-3 sm:flex-none">
      <Filter
        size={14}
        aria-hidden="true"
        className="shrink-0 text-muted-foreground"
      />
      <Select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        variant="bare"
        size="sm"
        wrapperClassName="min-w-0 flex-1"
        triggerClassName="min-w-0 flex-1"
      >
        {children}
      </Select>
    </label>
  );
}

export function OrdersList() {
  const t = useT("orders");
  const common = useT("common");
  const auth = useT("auth");
  const identity = useIdentity();
  const confirm = useConfirmDialog();
  const [orders, setOrders] = useState<OrderListItem[] | null>(null);
  const [companies, setCompanies] = useState<DeliveryCompany[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loadError, setLoadError] = useState<ApiError | Error | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filters, setFilters] = useState<OrderFilters>(() => ({
    ...EMPTY_FILTERS,
    query: new URLSearchParams(window.location.search).get("search") ?? "",
  }));
  const [sortKey, setSortKey] = useState<OrderSortKey>("createdAt");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkDispatchOpen, setBulkDispatchOpen] = useState(false);
  const [bulkDispatchCompany, setBulkDispatchCompany] = useState("");
  const [bulkDispatching, setBulkDispatching] = useState(false);
  const deferredFilters = useDeferredValue(filters);
  const pageSize = 10;

  async function load(productId?: string) {
    if (!canScope(identity, "orders:read")) return;
    setLoadError(null);
    try {
      const mayReadDelivery = canScope(identity, "delivery:read");
      const mayReadProducts = canScope(identity, "products:read");
      const [orderResponse, companyResponse, driverResponse, productResponse] =
        await Promise.all([
          listOrders({
            limit: 100,
            offset: 0,
            ...(productId && productId !== "all" ? { productId } : {}),
          }),
          mayReadDelivery ? listDeliveryCompanies(true) : Promise.resolve([]),
          mayReadDelivery ? listDrivers() : Promise.resolve([]),
          mayReadProducts ? listProducts().catch(() => []) : Promise.resolve([]),
        ]);
      setOrders(orderResponse.data ?? []);
      setCompanies(companyResponse);
      setDrivers(driverResponse);
      setProducts(productResponse);
      setSelectedIds((current) => {
        if (current.size === 0) return current;
        const live = new Set((orderResponse.data ?? []).map((order) => order.id));
        const next = new Set([...current].filter((id) => live.has(id)));
        return next.size === current.size ? current : next;
      });
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause : new Error(String(cause)));
    }
  }

  useEffect(() => {
    void load();
  }, [identity?.role, identity?.scopes.join(",")]);

  // Product filter is server-side (list items carry no line data) — reload
  // the list when it changes; every other filter stays client-side.
  const activeProduct = filters.product;
  useEffect(() => {
    if (orders !== null) void load(activeProduct);
  }, [activeProduct]);

  useEffect(() => {
    setPage(1);
  }, [deferredFilters, sortKey, sortDirection]);

  if (!canScope(identity, "orders:read")) {
    return (
      <Alert role="alert" tone="critical">
        {auth("no_access")}
      </Alert>
    );
  }

  if (loadError) {
    return (
      <Alert role="alert" tone="critical">
        <AlertCircle size={18} className="mt-0.5 shrink-0" />
        <div>
          <p className="font-semibold">{t("load_error")}</p>
          <p className="mt-1 text-xs opacity-80">{loadError.message}</p>
          <button
            type="button"
            onClick={() => void load(filters.product)}
            className="mt-3 text-xs font-semibold underline underline-offset-4"
          >
            {common("retry")}
          </button>
        </div>
      </Alert>
    );
  }

  if (orders === null) return <OrderSkeleton />;

  const filteredOrders = filterOrders(orders, deferredFilters);
  const sortedOrders = sortOrders(filteredOrders, sortKey, sortDirection);
  const totalPages = Math.max(1, Math.ceil(sortedOrders.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visibleOrders = paginateOrders(sortedOrders, safePage, pageSize);
  const wilayas = [
    ...new Set(orders.map((order) => order.wilaya).filter(Boolean)),
  ] as string[];
  const hasFilters = Object.values(filters).some(
    (value) => value !== "all" && value !== "",
  );

  function setFilter(key: keyof OrderFilters, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function handleSort(key: string) {
    const cast = key as OrderSortKey;
    if (sortKey === cast)
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    else {
      setSortKey(cast);
      setSortDirection("asc");
    }
  }

  const canDelete = canScope(identity, "orders:delete");
  const showCheckbox = canDelete;
  const selectedCount = selectedIds.size;
  const visibleIds = visibleOrders.map((order) => order.id);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));

  function toggleOne(id: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAllVisible(checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) {
        for (const id of visibleIds) next.add(id);
      } else {
        for (const id of visibleIds) next.delete(id);
      }
      return next;
    });
  }

  async function onBulkDelete() {
    if (selectedIds.size === 0 || bulkDeleting) return;
    const ids = [...selectedIds];
    if (
      !(await confirm({
        title: t("bulk_delete_title").replace("{count}", String(ids.length)),
        description: common("delete_description"),
        confirmLabel: t("bulk_delete"),
        tone: "danger",
      }))
    )
      return;
    setBulkDeleting(true);
    try {
      const result = await bulkDeleteOrders(ids);
      setOrders((current) =>
        current?.filter((item) => !result.deleted.includes(item.id)) ?? current,
      );
      setSelectedIds((current) => {
        const next = new Set(current);
        for (const id of result.deleted) next.delete(id);
        return next;
      });
      if (result.failed.length === 0) {
        notify.success(
          t("bulk_deleted").replace("{count}", String(result.deleted.length)),
        );
      } else {
        const message = t("bulk_delete_partial")
          .replace("{count}", String(result.deleted.length))
          .replace("{failed}", String(result.failed.length));
        setActionError(message);
        notify.success(message);
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setActionError(message);
      notify.error(message);
    } finally {
      setBulkDeleting(false);
    }
  }

  async function onBulkDispatch() {
    if (selectedIds.size === 0 || bulkDispatching || !bulkDispatchCompany) return;
    const ids = [...selectedIds];
    setBulkDispatching(true);
    try {
      const res = await bulkDispatchOrders(bulkDispatchCompany, ids);
      const ok = res.data.results.filter((r) => r.trackingNumber).length;
      const fail = res.data.results.filter((r) => r.error).length;
      if (ok > 0) {
        notify.success(`${ok} dispatched${fail ? `, ${fail} failed` : ""}`);
        setSelectedIds(new Set());
        await load(filters.product);
      }
      if (fail > 0) {
        const msg = res.data.results
          .filter((r) => r.error)
          .map((r) => `${r.orderNumber ?? r.orderId}: ${r.error}`)
          .join(" | ");
        setActionError(msg);
      }
      setBulkDispatchOpen(false);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setActionError(message);
      notify.error(message);
    } finally {
      setBulkDispatching(false);
    }
  }

  const selectedOrders = orders ? orders.filter((o) => selectedIds.has(o.id)) : [];
  const dispatchableSelected = selectedOrders.filter((o) => canDispatchOrder(o));
  const canBulkDispatch =
    canScope(identity, "delivery:dispatch") &&
    companies.length > 0 &&
    dispatchableSelected.length > 0;

  const rowProps = {
    drivers,
    companies,
    onChanged: () => void load(filters.product),
    onError: setActionError,
    onNoteSaved: (id: string, internalNote: string | null) =>
      setOrders((current) =>
        current?.map((item) => (item.id === id ? { ...item, internalNote } : item)) ?? current,
      ),
    showCheckbox,
  };

  return (
    <div className="space-y-3">
      {actionError && (
        <Alert role="alert" tone="critical">
          <AlertCircle size={18} className="shrink-0" />
          <div className="flex-1">{actionError}</div>
          <button
            type="button"
            onClick={() => setActionError(null)}
            aria-label={common("cancel")}
          >
            <X size={16} />
          </button>
        </Alert>
      )}
      {selectedCount > 0 && (canDelete || canBulkDispatch) && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-3 py-2">
          <span className="text-xs font-semibold text-muted-foreground">
            {t("selected_count").replace("{count}", String(selectedCount))}
          </span>
          <span className="flex-1" />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setSelectedIds(new Set())}
          >
            {t("clear_selection")}
          </Button>
          {canBulkDispatch && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setBulkDispatchOpen(true)}
            >
              <Building2 size={14} />
              Dispatch ({dispatchableSelected.length})
            </Button>
          )}
          {canDelete && (
            <Button
              type="button"
              variant="danger"
              size="sm"
              disabled={bulkDeleting}
              onClick={() => void onBulkDelete()}
            >
              <Trash2 size={14} />
              {t("bulk_delete")} ({selectedCount})
            </Button>
          )}
        </div>
      )}
      {bulkDispatchOpen && (
        <Dialog title="Dispatch selected" onClose={() => setBulkDispatchOpen(false)}>
          <p className="mb-3 text-sm text-muted-foreground">
            {dispatchableSelected.length} of {selectedCount} selected can be dispatched. Address will default to commune (البلدية) if empty, weight defaults to 1kg.
          </p>
          <Select
            value={bulkDispatchCompany}
            onChange={(e) => setBulkDispatchCompany(e.currentTarget.value)}
          >
            <option value="">Select delivery company</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Button
            type="button"
            className="mt-4 w-full"
            disabled={!bulkDispatchCompany || bulkDispatching}
            onClick={() => void onBulkDispatch()}
          >
            {bulkDispatching ? "Dispatching..." : `Dispatch ${dispatchableSelected.length} orders`}
          </Button>
        </Dialog>
      )}
      <Card flush>
        <div className="space-y-3 border-b border-border p-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <SearchInput
              value={filters.query}
              onChange={(query) => setFilter("query", query)}
              placeholder={t("search_placeholder")}
            />
            <span className="shrink-0 text-xs font-medium text-muted-foreground">
              {filteredOrders.length} {t("orders_count")}
            </span>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <FilterSelect
              label={t("filters.status")}
              value={filters.status}
              onChange={(value) => setFilter("status", value)}
            >
              <option value="all">{t("status.all")}</option>
              {FILTER_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t(`status.${status}`)}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect
              label={t("filters.delivery_method")}
              value={filters.delivery}
              onChange={(value) => setFilter("delivery", value)}
            >
              <option value="all">{t("filters.all_delivery")}</option>
              <option value="driver">{t("filters.driver")}</option>
              <option value="company">{t("filters.company")}</option>
              <option value="unassigned">{t("filters.unassigned")}</option>
            </FilterSelect>
            <FilterSelect
              label={t("filters.type")}
              value={filters.type}
              onChange={(value) => setFilter("type", value)}
            >
              <option value="all">{t("filters.type")}</option>
              <option value="online">{t("type.online")}</option>
              <option value="offline">{t("type.offline")}</option>
            </FilterSelect>
            {wilayas.length > 1 && (
              <FilterSelect
                label={t("filters.wilaya")}
                value={filters.wilaya}
                onChange={(value) => setFilter("wilaya", value)}
              >
                <option value="all">{t("filters.all_wilayas")}</option>
                {wilayas.map((wilaya) => (
                  <option key={wilaya} value={wilaya}>
                    {wilaya}
                  </option>
                ))}
              </FilterSelect>
            )}
            {products.length > 0 && (
              <FilterSelect
                label={t("filters.product")}
                value={filters.product}
                onChange={(value) => setFilter("product", value)}
              >
                <option value="all">{t("filters.all_products")}</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </FilterSelect>
            )}
            {hasFilters && (
              <button
                type="button"
                onClick={() => setFilters(EMPTY_FILTERS)}
                className="h-10 rounded-lg px-3 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {common("cancel")}
              </button>
            )}
          </div>
        </div>

        {filteredOrders.length === 0 ? (
          <EmptyState
            icon={<PackageOpen size={22} />}
            title={
              hasFilters ? common("no_results_found") : t("empty_state.title")
            }
            description={hasFilters ? undefined : t("empty_state.description")}
            action={
              !hasFilters && canScope(identity, "orders:create") ? (
                <LinkButton href="/orders/new">
                  {t("empty_state.action")}
                </LinkButton>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="divide-y divide-border md:hidden">
              {visibleOrders.map((order) => (
                <OrderMobileCard
                  key={order.id}
                  order={order}
                  {...rowProps}
                  selected={selectedIds.has(order.id)}
                  onToggle={(checked) => toggleOne(order.id, checked)}
                />
              ))}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <Table className="min-w-[1120px]">
                <TableHeader>
                  <TableRow className="text-xs font-semibold text-muted-foreground">
                    {showCheckbox && (
                      <TableHead className="w-10">
                        <input
                          type="checkbox"
                          checked={allVisibleSelected}
                          ref={(node) => {
                            if (node) {
                              const some =
                                !allVisibleSelected &&
                                visibleIds.some((id) => selectedIds.has(id));
                              node.indeterminate = some;
                            }
                          }}
                          onChange={(event) =>
                            toggleAllVisible(event.currentTarget.checked)
                          }
                          aria-label={t("select_all")}
                          className="size-4 accent-primary"
                        />
                      </TableHead>
                    )}
                    <SortHeader
                      label={t("table.order_number")}
                      sortKey="orderNumber"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={handleSort}
                    />
                    <SortHeader
                      label={t("table.customer")}
                      sortKey="customerName"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={handleSort}
                    />
                    <TableHead className="text-start">
                      {t("table.phone")}
                    </TableHead>
                    <SortHeader
                      label={t("table.status")}
                      sortKey="status"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={handleSort}
                    />
                    <SortHeader
                      label={t("table.wilaya")}
                      sortKey="wilaya"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={handleSort}
                    />
                    <TableHead className="text-start">
                      {t("table.delivery")}
                    </TableHead>
                    <SortHeader
                      label={t("table.total")}
                      sortKey="total"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={handleSort}
                      align="end"
                    />
                    <TableHead className="text-start">
                      {t("table.note")}
                    </TableHead>
                    <TableHead className="w-12">
                      <span className="sr-only">{common("table.actions")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleOrders.map((order) => (
                    <OrderDesktopRow
                      key={order.id}
                      order={order}
                      {...rowProps}
                      selected={selectedIds.has(order.id)}
                      onToggle={(checked) => toggleOne(order.id, checked)}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>

            <Pagination
              page={safePage}
              totalPages={totalPages}
              total={sortedOrders.length}
              pageSize={pageSize}
              onPageChange={setPage}
            />
          </>
        )}
      </Card>
    </div>
  );
}
