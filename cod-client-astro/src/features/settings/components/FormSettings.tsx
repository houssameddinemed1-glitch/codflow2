import { useEffect, useState } from "react";
import { LayoutTemplate } from "lucide-react";
import { useT } from "@/i18n/react";
import { getFormConfig, saveFormConfig } from "@/features/settings/api";
import { FieldRow, SettingsSection } from "@/features/settings/components/SettingsSection";

type FormVariant = "default" | "form_a";

/**
 * To add a future variation (Form B, C…):
 * 1. Build `variants/FormB.astro` in the theme (same Props + DOM contract as OrderForm).
 * 2. Handle it in `OrderFormVariant.astro` + add "form_b" to the server FORM_VARIANTS list.
 * 3. Append { value: "form_b", … } here with matching locale keys.
 */
const VARIANTS: { value: FormVariant; labelKey: string; hintKey: string }[] = [
  { value: "default", labelKey: "store.form_default_label", hintKey: "store.form_default_hint" },
  { value: "form_a", labelKey: "store.form_a_label", hintKey: "store.form_a_hint" },
];

/**
 * Order form variation picker. Selecting a card makes it the active
 * storefront checkout form on save. The Default form is never modified —
 * variations are separate theme components sharing the same fields.
 */
export function FormSettings() {
  const t = useT("settings");
  const [variant, setVariant] = useState<FormVariant>("default");
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getFormConfig()
      .then((data) => {
        if (!alive || !data) return;
        if (data.variant === "default" || data.variant === "form_a") {
          setVariant(data.variant);
        }
        setLastSaved(data.updatedAt);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  async function handleSave() {
    const result = await saveFormConfig({ variant });
    setLastSaved(result.updatedAt);
  }

  return (
    <SettingsSection
      icon={LayoutTemplate}
      title={t("store.form_title")}
      subtitle={t("store.form_subtitle")}
      onSave={handleSave}
    >
      <FieldRow label={t("store.form_active_label")} hint={t("store.form_active_hint")}>
        <div className="grid gap-2" role="radiogroup" aria-label={t("store.form_active_label")}>
          {VARIANTS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={variant === option.value}
              onClick={() => setVariant(option.value)}
              className={`cursor-pointer rounded-xl border p-3 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                variant === option.value
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/40"
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                {t(option.labelKey)}
                {variant === option.value && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">
                    {t("store.form_active_badge")}
                  </span>
                )}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {t(option.hintKey)}
              </span>
            </button>
          ))}
        </div>
      </FieldRow>

      {lastSaved && (
        <p className="text-xs text-muted-foreground">
          {t("store.form_last_saved")}: {new Date(lastSaved).toLocaleString()}
        </p>
      )}
    </SettingsSection>
  );
}
