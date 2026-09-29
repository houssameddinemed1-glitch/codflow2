import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useLocale, useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import {
  listCommunes,
  listProducts,
  listWilayas,
  updateOrder,
} from "@/features/orders/api";
import { formatMoney } from "@/features/orders/model";
import type {
  Commune,
  OrderDetail,
  Product,
  Wilaya,
} from "@/features/orders/types";
import { Button, Dialog, Field, Input, Select } from "@/components/ui";

interface EditableLine {
  key: string;
  productId: string;
  productName: string;
  variantId?: string;
  variantLabel?: string;
  quantity: number;
  pricePerUnit: number;
}

export function OrderEditDialog({
  order,
  onClose,
  onChanged,
  onError,
}: {
  order: OrderDetail;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const t = useT("orders");
  const common = useT("common");
  const locale = useLocale();

  const [customerName, setCustomerName] = useState(order.customerName);
  const [phone, setPhone] = useState(order.phone);
  const [customerEmail, setCustomerEmail] = useState(order.customerEmail ?? "");
  const [wilayaId, setWilayaId] = useState(
    order.wilayaId ? String(order.wilayaId) : "",
  );
  const [communeId, setCommuneId] = useState(order.communeId ?? "");
  const [address, setAddress] = useState(order.address ?? "");
  const [deliveryType, setDeliveryType] = useState<"home" | "stop_desk">(
    order.deliveryType,
  );
  const [deliveryFee, setDeliveryFee] = useState(String(order.deliveryFee));
  const [notes, setNotes] = useState(order.notes ?? "");
  const [lines, setLines] = useState<EditableLine[]>(() =>
    order.products.map((p) => ({
      key: p.id,
      productId: p.productId,
      productName: p.productName,
      variantId: p.variantId ?? undefined,
      variantLabel: p.variantLabel ?? undefined,
      quantity: p.quantity,
      pricePerUnit: p.pricePerUnit,
    })),
  );

  const [wilayas, setWilayas] = useState<Wilaya[]>([]);
  const [communes, setCommunes] = useState<Commune[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void Promise.all([listWilayas(), listProducts()]).then(
      ([wilayaRows, productRows]) => {
        if (!alive) return;
        setWilayas(wilayaRows);
        setProducts(productRows);
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!wilayaId) {
      setCommunes([]);
      return;
    }
    void listCommunes(Number(wilayaId))
      .then(setCommunes)
      .catch(() => setCommunes([]));
  }, [wilayaId]);

  const selectedProduct = products.find((p) => p.id === productId);
  const variants = useMemo(
    () => selectedProduct?.variants.filter((v) => v.active) ?? [],
    [selectedProduct],
  );
  const selectedVariant = variants.find((v) => v.id === variantId);
  const subtotal = lines.reduce(
    (sum, line) => sum + line.quantity * line.pricePerUnit,
    0,
  );
  const feeNumber = Number(deliveryFee) || 0;

  function addLine() {
    if (!selectedProduct || (variants.length > 0 && !selectedVariant)) return;
    setLines((current) => [
      ...current,
      {
        key: crypto.randomUUID(),
        productId: selectedProduct.id,
        productName: selectedProduct.name,
        variantId: selectedVariant?.id,
        variantLabel: selectedVariant
          ? Object.values(selectedVariant.variations).join(" / ")
          : undefined,
        quantity: Math.max(1, quantity),
        pricePerUnit: selectedVariant?.price ?? selectedProduct.price,
      },
    ]);
    setProductId("");
    setVariantId("");
    setQuantity(1);
  }

  function updateLine(key: string, patch: Partial<EditableLine>) {
    setLines((current) =>
      current.map((line) => {
        if (line.key !== key) return line;
        const next = { ...line, ...patch };
        if (patch.productId) {
          const product = products.find((p) => p.id === patch.productId);
          if (product) {
            next.productName = product.name;
            next.variantId = undefined;
            next.variantLabel = undefined;
            next.pricePerUnit = product.price;
          }
        }
        if (patch.variantId !== undefined) {
          const product = products.find((p) => p.id === next.productId);
          const variant = product?.variants.find((v) => v.id === patch.variantId);
          next.variantLabel = variant
            ? Object.values(variant.variations).join(" / ")
            : undefined;
          if (variant) next.pricePerUnit = variant.price;
        }
        next.quantity = Math.max(1, Math.floor(Number(next.quantity) || 1));
        next.pricePerUnit = Math.max(0, Number(next.pricePerUnit) || 0);
        return next;
      }),
    );
  }

  async function submit() {
    const nextErrors: Record<string, string> = {};
    if (!customerName.trim())
      nextErrors.customerName = t("form.error_customer_name");
    if (!/^0[5-7]\d{8}$/.test(phone.trim()))
      nextErrors.phone = t("form.error_invalid_phone");
    if (!wilayaId) nextErrors.wilayaId = t("form.error_wilaya");
    if (!communeId) nextErrors.communeId = t("form.error_commune");
    if (deliveryType === "home" && !address.trim())
      nextErrors.address = t("form.error_address");
    if (lines.length === 0) nextErrors.products = t("form.error_no_products");
    if (feeNumber < 0) nextErrors.deliveryFee = t("form.error_fee");
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setBusy(true);
    try {
      await updateOrder(order.id, {
        customerName: customerName.trim(),
        phone: phone.trim(),
        // Empty box clears the email (null); a value is canonicalised server-side.
        customerEmail: customerEmail.trim() || null,
        wilayaId: Number(wilayaId),
        communeId,
        address: address.trim() || null,
        deliveryType,
        deliveryFee: feeNumber,
        notes: notes.trim() || null,
        price: subtotal,
        products: lines.map((line) => ({
          productId: line.productId,
          productName: line.productName,
          variantId: line.variantId ?? null,
          variantLabel: line.variantLabel ?? null,
          quantity: line.quantity,
          pricePerUnit: line.pricePerUnit,
        })),
      });
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
      notify.error(common("feedback.action_failed"));
      setBusy(false);
      return;
    }
    notify.success(t("form.success_edit"));
    try {
      await onChanged();
      onClose();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={t("form.title_edit")}
      description={order.orderNumber}
      onClose={onClose}
      className="sm:max-w-2xl"
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("form.customer_name_label")} error={errors.customerName}>
            <Input
              value={customerName}
              onChange={(e) => setCustomerName(e.currentTarget.value)}
              placeholder={t("form.customer_name_placeholder")}
            />
          </Field>
          <Field label={t("form.phone_label")} error={errors.phone}>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.currentTarget.value)}
              placeholder={t("form.phone_placeholder")}
              dir="ltr"
            />
          </Field>
          <Field label={t("form.email_label")} error={errors.customerEmail}>
            <Input
              type="email"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.currentTarget.value)}
              placeholder={t("form.email_placeholder")}
              inputMode="email"
              autoComplete="email"
              maxLength={254}
              dir="ltr"
            />
          </Field>
          <Field label={t("form.wilaya_label")} error={errors.wilayaId}>
            <Select
              value={wilayaId}
              onChange={(e) => {
                setWilayaId(e.currentTarget.value);
                setCommuneId("");
              }}
            >
              <option value="">{t("form.wilaya_placeholder")}</option>
              {wilayas.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.id} · {locale === "ar" ? w.nameAr : w.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("form.commune_label")} error={errors.communeId}>
            <Select
              value={communeId}
              onChange={(e) => setCommuneId(e.currentTarget.value)}
            >
              <option value="">{t("form.commune_placeholder")}</option>
              {communes.map((c) => (
                <option key={c.id} value={c.id}>
                  {locale === "ar" ? c.nameAr : c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label={t("form.address_label")} error={errors.address}>
          <Input
            value={address}
            onChange={(e) => setAddress(e.currentTarget.value)}
            placeholder={t("form.address_placeholder")}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("form.delivery_type_label")}>
            <Select
              value={deliveryType}
              onChange={(e) =>
                setDeliveryType(e.currentTarget.value as "home" | "stop_desk")
              }
            >
              <option value="home">{t("form.delivery_type_home")}</option>
              <option value="stop_desk">{t("form.delivery_type_desk")}</option>
            </Select>
          </Field>
          <Field label={t("form.delivery_fee_label")} error={errors.deliveryFee}>
            <Input
              type="number"
              min="0"
              value={deliveryFee}
              onChange={(e) => setDeliveryFee(e.currentTarget.value)}
            />
          </Field>
        </div>

        <div className="space-y-3 rounded-xl border border-border p-4">
          <p className="text-sm font-bold">{t("form.products_section")}</p>
          {errors.products && (
            <p className="text-xs font-medium text-destructive">
              {errors.products}
            </p>
          )}
          <div className="space-y-2">
            {lines.map((line) => {
              const product = products.find((p) => p.id === line.productId);
              const lineVariants =
                product?.variants.filter((v) => v.active) ?? [];
              return (
                <div
                  key={line.key}
                  className="grid gap-2 rounded-lg bg-muted/40 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
                >
                  <Select
                    value={line.productId}
                    onChange={(e) =>
                      updateLine(line.key, { productId: e.currentTarget.value })
                    }
                    aria-label={t("form.select_product")}
                  >
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                  {lineVariants.length > 0 ? (
                    <Select
                      value={line.variantId ?? ""}
                      onChange={(e) =>
                        updateLine(line.key, { variantId: e.currentTarget.value })
                      }
                      aria-label={t("form.select_variation")}
                    >
                      <option value="">{t("form.select_variation")}</option>
                      {lineVariants.map((v) => (
                        <option key={v.id} value={v.id}>
                          {Object.values(v.variations).join(" / ")}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input value={line.variantLabel ?? ""} disabled placeholder="—" />
                  )}
                  <Input
                    type="number"
                    min="1"
                    value={line.quantity}
                    onChange={(e) =>
                      updateLine(line.key, {
                        quantity: Number(e.currentTarget.value),
                      })
                    }
                    aria-label={t("form.quantity_label")}
                  />
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min="0"
                      value={line.pricePerUnit}
                      onChange={(e) =>
                        updateLine(line.key, {
                          pricePerUnit: Number(e.currentTarget.value),
                        })
                      }
                      aria-label={t("detail.price")}
                    />
                    <button
                      type="button"
                      aria-label={t("form.remove_product")}
                      onClick={() =>
                        setLines((current) =>
                          current.filter((item) => item.key !== line.key),
                        )
                      }
                      className="grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground sm:col-span-2">
                    {line.quantity} × {formatMoney(line.pricePerUnit, locale)} ={" "}
                    <span className="font-semibold text-foreground">
                      {formatMoney(line.quantity * line.pricePerUnit, locale)}
                    </span>
                  </p>
                </div>
              );
            })}
          </div>
          <div className="flex items-end gap-3">
            <Field label={t("form.select_product")} className="flex-1">
              <Select
                value={productId}
                onChange={(e) => {
                  setProductId(e.currentTarget.value);
                  setVariantId("");
                }}
              >
                <option value="">{t("form.select_product")}</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {formatMoney(p.price, locale)}
                  </option>
                ))}
              </Select>
            </Field>
            {variants.length > 0 && (
              <Field label={t("form.select_variation")} className="flex-1">
                <Select
                  value={variantId}
                  onChange={(e) => setVariantId(e.currentTarget.value)}
                >
                  <option value="">{t("form.select_variation")}</option>
                  {variants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {Object.values(v.variations).join(" / ")} ·{" "}
                      {formatMoney(v.price, locale)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Button
              type="button"
              variant="secondary"
              onClick={addLine}
              disabled={!selectedProduct || (variants.length > 0 && !selectedVariant)}
            >
              <Plus size={16} />
              {t("form.add_product")}
            </Button>
          </div>
        </div>

        <Field label={t("form.notes_label")}>
          <Input
            value={notes}
            onChange={(e) => setNotes(e.currentTarget.value)}
          />
        </Field>

        <div className="flex justify-between rounded-xl bg-muted/40 px-4 py-3 text-sm font-bold">
          <span>{t("form.order_total")}</span>
          <span className="tabular-nums">
            {formatMoney(subtotal + feeNumber, locale)}
          </span>
        </div>
      </div>
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
          {t("form.cancel")}
        </Button>
        <Button type="button" onClick={() => void submit()} disabled={busy}>
          <Pencil size={15} />
          {busy ? t("form.saving") : t("form.save")}
        </Button>
      </div>
    </Dialog>
  );
}
