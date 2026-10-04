import type { Dispatch, SetStateAction } from "react";
import { Card, Field, Input, Select } from "@/components/ui";
import { useT } from "@/i18n/react";
import type { ShippingProfile } from "@/features/products/types";
import { RichTextEditor } from "@/features/products/components/RichTextEditor";

interface ProductBasicInfoCardProps {
  name: string;
  setName: (val: string) => void;
  sku: string;
  setSku: (val: string) => void;
  slug: string;
  setSlug: (val: string) => void;
  categoryId: string;
  setCategoryId: (val: string) => void;
  shippingProfileId: string;
  setShippingProfileId: (val: string) => void;
  description: string;
  setDescription: (val: string) => void;
  descriptionFormat: "text" | "html";
  setDescriptionFormat: (val: "text" | "html") => void;
  groups: Array<{ id: string; name: string }>;
  shippingProfiles: ShippingProfile[];
  errors: Record<string, string>;
  setErrors: Dispatch<SetStateAction<Record<string, string>>>;
  busy: boolean;
  hasVariantsSwitch: boolean;
}

export function ProductBasicInfoCard({
  name,
  setName,
  sku,
  setSku,
  slug,
  setSlug,
  categoryId,
  setCategoryId,
  shippingProfileId,
  setShippingProfileId,
  description,
  setDescription,
  descriptionFormat,
  setDescriptionFormat,
  groups,
  shippingProfiles,
  errors,
  setErrors,
  busy,
  hasVariantsSwitch,
}: ProductBasicInfoCardProps) {
  const t = useT("products");

  return (
    <Card title={t("form.section_basic")}>
      <div className="grid gap-4">
        <Field label={`${t("form.name_label")} *`} error={errors.name}>
          <Input
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            placeholder={t("form.name_placeholder")}
            disabled={busy}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label={
              hasVariantsSwitch
                ? t("form.sku_label")
                : `${t("form.sku_label")} *`
            }
            error={errors.sku}
          >
            <Input
              value={sku}
              onChange={(event) => {
                setSku(event.currentTarget.value);
                setErrors((prev) => ({ ...prev, sku: "" }));
              }}
              placeholder={t("form.sku_placeholder")}
              className="font-mono"
              disabled={busy || hasVariantsSwitch}
              dir="ltr"
            />
          </Field>
          <Field label={t("form.group_label")}>
            <Select
              value={categoryId}
              onChange={(event) => setCategoryId(event.currentTarget.value)}
              disabled={busy}
            >
              <option value="">{t("form.group_placeholder")}</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("form.slug_label")}>
            <Input
              value={slug}
              onChange={(event) => setSlug(event.currentTarget.value)}
              className="font-mono"
              disabled={busy}
              dir="ltr"
            />
          </Field>
          {shippingProfiles.length > 0 && (
            <Field label="Shipping Profile">
              <Select
                value={shippingProfileId}
                onChange={(event) =>
                  setShippingProfileId(event.currentTarget.value)
                }
                disabled={busy}
              >
                <option value="">Default (store setting)</option>
                {shippingProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                    {profile.isDefault ? " ★" : ""}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        <Field label={t("form.description_label")} hint={t("form.description_hint")}>
          <div className="mb-2 inline-flex rounded-lg border border-input p-0.5 text-xs font-semibold" role="group" aria-label={t("form.description_format_label")}>
            {(["text", "html"] as const).map((format) => (
              <button
                key={format}
                type="button"
                onClick={() => setDescriptionFormat(format)}
                aria-pressed={descriptionFormat === format}
                className={`rounded-md px-2.5 py-1 transition-colors ${descriptionFormat === format ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {t(`form.description_format_${format}`)}
              </button>
            ))}
          </div>
          <RichTextEditor
            value={description}
            onChange={setDescription}
            disabled={busy}
            placeholder={t("form.description_placeholder")}
          />
        </Field>
      </div>
    </Card>
  );
}
