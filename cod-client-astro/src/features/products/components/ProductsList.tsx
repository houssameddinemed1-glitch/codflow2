import { useDeferredValue, useEffect, useState } from "react";
import { AlertCircle, Package, Plus, Trash2, X } from "lucide-react";
import { canScope, useIdentity } from "@/features/auth/components/RequireAuth";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  LinkButton,
  Pagination,
  SearchInput,
  Select,
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
  SortHeader,
  useConfirmDialog,
} from "@/components/ui";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { SCOPES } from "../../../../../cod-shared/rbac/scopes";
import {
  bulkDeleteProducts,
  deleteProduct,
  listAllProducts,
  listProductGroups,
} from "@/features/products/api";
import { getMyStore } from "@/features/settings/api";
import {
  filterProducts,
  paginateProducts,
  productErrorMessage,
  sortProducts,
  type ProductFilters,
  type ProductSortKey,
} from "@/features/products/model";
import type {
  Product,
  ProductCategory,
  ProductStatus,
} from "@/features/products/types";
import { ProductDesktopRow, ProductMobileCard } from "@/features/products/components/ProductRow";

const EMPTY_FILTERS: ProductFilters = {
  query: "",
  category: "all",
  status: "all",
};
const STATUS_OPTIONS: ProductStatus[] = ["ACTIVE", "DRAFT", "ARCHIVED"];
const PAGE_SIZE = 10;

function ProductSkeleton() {
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
          className="grid h-16 grid-cols-[1.5fr_0.8fr_0.8fr_0.6fr_0.6fr_0.6fr] items-center gap-4 border-b border-border px-4 last:border-0"
        >
          <div className="h-3 w-32 animate-pulse rounded bg-muted" />
          <div className="h-3 w-20 animate-pulse rounded bg-muted" />
          <div className="h-3 w-16 animate-pulse rounded bg-muted" />
          <div className="h-3 w-14 animate-pulse rounded bg-muted" />
          <div className="h-3 w-14 animate-pulse rounded bg-muted" />
          <span className="h-6 w-20 justify-self-end animate-pulse rounded-lg bg-muted" />
        </div>
      ))}
    </div>
  );
}

export function ProductsList() {
  const t = useT("products");
  const common = useT("common");
  const auth = useT("auth");
  const identity = useIdentity();
  const confirm = useConfirmDialog();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [storeDomain, setStoreDomain] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filters, setFilters] = useState<ProductFilters>(EMPTY_FILTERS);
  const [sortKey, setSortKey] = useState<ProductSortKey>("createdAt");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const deferredFilters = useDeferredValue(filters);

  async function load() {
    setLoadError(null);
    try {
      const [nextProducts, nextCategories, nextStore] = await Promise.all([
        listAllProducts(),
        listProductGroups().catch(() => []),
        getMyStore().catch(() => null),
      ]);
      setProducts(nextProducts);
      setCategories(nextCategories);
      setStoreDomain(nextStore?.domain ?? null);
      setSelectedIds((current) => {
        if (current.size === 0) return current;
        const live = new Set(nextProducts.map((product) => product.id));
        const next = new Set([...current].filter((id) => live.has(id)));
        return next.size === current.size ? current : next;
      });
    } catch (cause) {
      setLoadError(cause);
    }
  }

  useEffect(() => {
    if (canScope(identity, SCOPES.PRODUCTS_READ)) void load();
  }, [identity?.role, identity?.scopes.join(",")]);
  useEffect(() => {
    setPage(1);
  }, [deferredFilters, sortKey, sortDirection]);

  if (!canScope(identity, SCOPES.PRODUCTS_READ))
    return (
      <Alert role="alert" tone="critical">
        {auth("no_access")}
      </Alert>
    );
  if (loadError)
    return (
      <Alert role="alert" tone="critical">
        <AlertCircle size={18} className="shrink-0" />
        <div className="flex-1">
          <p className="font-semibold">{t("error_load")}</p>
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
  if (products === null) return <ProductSkeleton />;

  const categoryMap = new Map(
    categories.map((category) => [category.id, category]),
  );
  const filtered = filterProducts(products, deferredFilters);
  const sorted = sortProducts(filtered, sortKey, sortDirection);
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = paginateProducts(sorted, safePage, PAGE_SIZE);
  const hasFilters =
    filters.query.trim() !== "" ||
    filters.category !== "all" ||
    filters.status !== "all";
  const canManage = canScope(identity, SCOPES.PRODUCTS_MANAGE);
  const canCreate = canScope(identity, SCOPES.PRODUCTS_CREATE);
  const showCheckbox = canManage;
  const selectedCount = selectedIds.size;
  const visibleIds = visible.map((product) => product.id);
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

  function onSort(key: string) {
    const cast = key as ProductSortKey;
    if (sortKey === cast)
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    else {
      setSortKey(cast);
      setSortDirection("asc");
    }
  }
  async function onDelete(product: Product) {
    if (
      !(await confirm({
        title: common("confirm_delete_title").replace("{name}", product.name),
        description: common("delete_description"),
        confirmLabel: common("delete"),
        tone: "danger",
      }))
    )
      return;
    try {
      await deleteProduct(product.id);
      setProducts(
        (current) =>
          current?.filter((item) => item.id !== product.id) ?? current,
      );
      setSelectedIds((current) => {
        if (!current.has(product.id)) return current;
        const next = new Set(current);
        next.delete(product.id);
        return next;
      });
      notify.success(t("success_deleted"));
    } catch (cause) {
      const message = productErrorMessage(cause, t);
      setActionError(message);
      notify.error(message);
    }
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
      const result = await bulkDeleteProducts(ids);
      setProducts(
        (current) =>
          current?.filter((item) => !result.deleted.includes(item.id)) ??
          current,
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
      } else if (result.deleted.length > 0) {
        const message = t("bulk_delete_partial")
          .replace("{count}", String(result.deleted.length))
          .replace("{failed}", String(result.failed.length));
        setActionError(message);
        notify.success(message);
      } else {
        const message = productErrorMessage(
          { code: "PRODUCT_HAS_ORDERS" },
          t,
        );
        setActionError(message);
        notify.error(message);
      }
    } catch (cause) {
      const message = productErrorMessage(cause, t);
      setActionError(message);
      notify.error(message);
    } finally {
      setBulkDeleting(false);
    }
  }

  const rowProps = {
    categoryMap,
    canManage,
    onDelete,
    storeDomain,
    showCheckbox,
  };

  return (
    <div className="space-y-3">
      {actionError && (
        <Alert role="alert" tone="critical">
          <AlertCircle size={18} className="shrink-0" />
          <span className="flex-1">{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            aria-label={common("cancel")}
          >
            <X size={16} />
          </button>
        </Alert>
      )}
      {selectedCount > 0 && canManage && (
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
        </div>
      )}
      <Card flush>
        <div className="space-y-3 border-b border-border p-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <SearchInput
              value={filters.query}
              onChange={(query) =>
                setFilters((current) => ({ ...current, query }))
              }
              placeholder={t("search_placeholder")}
            />
            <span className="shrink-0 text-xs font-medium text-muted-foreground">
              {filtered.length} {t("products_count")}
            </span>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select
              aria-label={t("filters.group")}
              value={filters.category}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  category: event.currentTarget.value,
                }))
              }
              wrapperClassName="sm:w-52"
            >
              <option value="all">{common("table.all")}</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
            <Select
              aria-label={t("filters.availability")}
              value={filters.status}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  status: event.currentTarget.value as ProductStatus | "all",
                }))
              }
              wrapperClassName="sm:w-48"
            >
              <option value="all">{common("table.all")}</option>
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {t(`status_options.${status.toLocaleLowerCase()}`)}
                </option>
              ))}
            </Select>
            {hasFilters && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setFilters(EMPTY_FILTERS)}
              >
                {common("cancel")}
              </Button>
            )}
          </div>
        </div>
        {sorted.length === 0 ? (
          <EmptyState
            icon={<Package size={22} />}
            title={
              hasFilters ? common("no_results_found") : t("empty_state.title")
            }
            description={hasFilters ? undefined : t("empty_state.description")}
            action={
              !hasFilters && canCreate ? (
                <LinkButton href="/products/new">
                  <Plus size={16} />
                  {t("empty_state.action")}
                </LinkButton>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="divide-y divide-border md:hidden">
              {visible.map((product) => (
                <ProductMobileCard
                  key={product.id}
                  product={product}
                  {...rowProps}
                  selected={selectedIds.has(product.id)}
                  onToggle={(checked) => toggleOne(product.id, checked)}
                />
              ))}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow>
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
                      label={t("table.name")}
                      sortKey="name"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={onSort}
                    />
                    <TableHead>{t("table.group")}</TableHead>
                    <TableHead>{t("table.status")}</TableHead>
                    <SortHeader
                      label={t("table.price")}
                      sortKey="price"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={onSort}
                    />
                    <SortHeader
                      label={t("table.variants")}
                      sortKey="variantsCount"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={onSort}
                    />
                    <SortHeader
                      label={t("table.stock")}
                      sortKey="totalInventory"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={onSort}
                    />
                    <SortHeader
                      label={t("table.reviews")}
                      sortKey="reviewCount"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={onSort}
                    />
                    <TableHead className="text-end">
                      {common("table.actions")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((product) => (
                    <ProductDesktopRow
                      key={product.id}
                      product={product}
                      {...rowProps}
                      selected={selectedIds.has(product.id)}
                      onToggle={(checked) => toggleOne(product.id, checked)}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
            <Pagination
              page={safePage}
              totalPages={totalPages}
              total={sorted.length}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
            />
          </>
        )}
      </Card>
    </div>
  );
}
