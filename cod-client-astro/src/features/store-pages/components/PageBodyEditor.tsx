import { useCallback } from "react";
import { RichTextEditor } from "@/features/products/components/RichTextEditor";
import { useLocale, useT } from "@/i18n/react";
import { RICH_TEXT_MAX_CHARS } from "../../../../../cod-shared/lib/rich-text";

export interface PageBodyEditorProps {
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  busy?: boolean;
}

/**
 * Exact length of the value this field will save — measures the serialized
 * HTML, matching the product description editor's counter.
 */
function BodyLength({ value }: { value: string }) {
  const t = useT("store-pages");
  const locale = useLocale();
  const over = value.length > RICH_TEXT_MAX_CHARS;

  return (
    <p className="flex items-center justify-end gap-1 text-[12px] text-muted-foreground">
      <span className={over ? "font-medium text-destructive" : undefined}>
        {value.length.toLocaleString(locale)}
      </span>
      <span aria-hidden="true">/</span>
      <span>{RICH_TEXT_MAX_CHARS.toLocaleString(locale)}</span>
      {over && (
        <span className="ms-1 font-medium text-destructive">
          {t("errors.validation")}
        </span>
      )}
    </p>
  );
}

/**
 * A store page's body — the same editor the product description uses, so a
 * merchant edits every rich-text field in this dashboard with one
 * muscle-memory. (Upstream uses a Tiptap template here; this tree ships a
 * dependency-free contentEditable editor with the same value contract.)
 */
export default function PageBodyEditor({
  value,
  onChange,
  disabled,
  busy,
}: PageBodyEditorProps) {
  const handleChange = useCallback(
    (html: string) => {
      onChange(html);
    },
    [onChange],
  );

  return (
    <div className="overflow-hidden rounded-md border border-border/60 bg-card">
      <RichTextEditor value={value} onChange={handleChange} disabled={disabled} busy={busy} />
      <div className="border-t border-border/60 px-3 py-1">
        <BodyLength value={value} />
      </div>
    </div>
  );
}
