import { useEffect, useRef, useState } from "react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  RemoveFormatting,
  Underline,
} from "lucide-react";
import { uploadProductImage } from "@/features/products/api";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";

/** Legacy <font size> → px. execCommand("fontSize") emits these; we normalize on every input. */
const FONT_PX: Record<string, number> = { 1: 12, 2: 13, 3: 16, 4: 18, 5: 20, 6: 28, 7: 36 };

/** execCommand fontSize numbers cycled by the size button. */
const SIZE_STEPS = [
  { legacy: "2", labelKey: "form.editor_size_small" },
  { legacy: "3", labelKey: "form.editor_size_normal" },
  { legacy: "5", labelKey: "form.editor_size_large" },
  { legacy: "6", labelKey: "form.editor_size_xl" },
] as const;

/** Read-back mapping: legacy number → step index. */
const SIZE_READBACK: Record<string, number> = { 1: 0, 2: 0, 3: 1, 4: 1, 5: 2, 6: 3, 7: 3 };

const BLOCK_STEPS = ["p", "h2", "h3"] as const;

const IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"];
const MAX_MB = 10;

function normalizeFonts(root: HTMLElement) {
  for (const font of Array.from(root.querySelectorAll("font"))) {
    const size = font.getAttribute("size");
    const px = (size && FONT_PX[size]) || 16;
    const span = document.createElement("span");
    span.setAttribute("style", `font-size: ${px}px`);
    span.innerHTML = font.innerHTML;
    font.replaceWith(span);
  }
}

function toolBtn(active: boolean): string {
  return `grid size-8 place-items-center rounded-lg transition-colors disabled:opacity-40 ${
    active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
  }`;
}

/**
 * Dependency-free rich text editor (contentEditable + execCommand).
 * Emits sanitized-later HTML (the API scrubs on save); supports bold,
 * italic, underline, headings, font sizes, lists, links, alignment, and
 * R2-hosted images via the same presigned flow as product images.
 */
export function RichTextEditor({
  value,
  onChange,
  disabled,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const t = useT("products");
  const common = useT("common");
  const editorRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const savedRange = useRef<Range | null>(null);
  const [uploading, setUploading] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [marks, setMarks] = useState({ bold: false, italic: false, underline: false, ul: false, ol: false });
  const [blockIndex, setBlockIndex] = useState(0);
  const [sizeIndex, setSizeIndex] = useState(1);

  // External value (loading an existing product) — never clobber the caret mid-typing.
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (document.activeElement !== el && el.innerHTML !== value) {
      el.innerHTML = value;
    }
  }, [value]);

  function emit() {
    const el = editorRef.current;
    if (!el) return;
    normalizeFonts(el);
    onChange(el.innerHTML);
  }

  function exec(command: string, arg?: string) {
    const el = editorRef.current;
    if (!el || disabled) return;
    el.focus();
    document.execCommand(command, false, arg);
    emit();
    refreshMarks();
  }

  function keepSelection(event: React.MouseEvent) {
    // Prevent toolbar clicks from collapsing the editor selection.
    event.preventDefault();
  }

  function refreshMarks() {
    try {
      setMarks({
        bold: document.queryCommandState("bold"),
        italic: document.queryCommandState("italic"),
        underline: document.queryCommandState("underline"),
        ul: document.queryCommandState("insertUnorderedList"),
        ol: document.queryCommandState("insertOrderedList"),
      });
      const block = document.queryCommandValue("formatBlock").toLowerCase();
      const bi = BLOCK_STEPS.indexOf(block as (typeof BLOCK_STEPS)[number]);
      setBlockIndex(bi === -1 ? 0 : bi);
      const size = document.queryCommandValue("fontSize");
      if (size && size in SIZE_READBACK) setSizeIndex(SIZE_READBACK[size]);
    } catch {
      /* execCommand state unavailable — buttons stay neutral */
    }
  }

  function cycleBlock() {
    const next = (blockIndex + 1) % BLOCK_STEPS.length;
    setBlockIndex(next);
    exec("formatBlock", BLOCK_STEPS[next]);
  }

  function cycleSize() {
    const next = (sizeIndex + 1) % SIZE_STEPS.length;
    setSizeIndex(next);
    exec("fontSize", SIZE_STEPS[next].legacy);
  }

  function openLinkBar() {
    const selection = window.getSelection();
    savedRange.current =
      selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
    const anchor = savedRange.current?.startContainer as Node | null;
    const linkEl = anchor instanceof Element ? anchor.closest?.("a") : anchor?.parentElement?.closest?.("a");
    setLinkUrl(linkEl?.getAttribute("href") ?? "");
    setLinkOpen(true);
  }

  function applyLink() {
    const el = editorRef.current;
    const range = savedRange.current;
    setLinkOpen(false);
    if (!el || disabled) return;
    el.focus();
    if (range) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    const url = linkUrl.trim();
    if (!url) {
      document.execCommand("unlink");
    } else if (/^(https?:\/\/|mailto:)/i.test(url)) {
      document.execCommand("createLink", false, url);
    } else {
      notify.error(t("form.editor_link_invalid"));
      return;
    }
    setLinkUrl("");
    emit();
  }

  async function handleImageFile(file: File | undefined) {
    const el = editorRef.current;
    if (!file || !el || disabled) return;
    if (!IMAGE_TYPES.includes(file.type)) {
      notify.error(common("feedback.unsupported_file"));
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      notify.error(common("feedback.file_too_large"));
      return;
    }
    setUploading(true);
    try {
      const { url } = await uploadProductImage(file);
      el.focus();
      document.execCommand("insertImage", false, url);
      emit();
      notify.success(common("feedback.uploaded"));
    } catch (cause) {
      console.error("[upload] proxy upload failed:", cause);
      notify.error(
        cause instanceof Error && cause.message
          ? `${common("feedback.upload_failed")} — ${cause.message}`
          : common("feedback.upload_failed")
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className={`overflow-hidden rounded-lg border border-border bg-background ${disabled ? "opacity-60" : ""}`}>
      <div
        className="flex flex-wrap items-center gap-0.5 border-b border-border bg-muted/40 p-1.5"
        role="toolbar"
        aria-label={ariaLabel ?? t("form.description_label")}
        onMouseDown={keepSelection}
      >
        <button type="button" disabled={disabled} title={t("form.editor_bold")} aria-label={t("form.editor_bold")} onClick={() => exec("bold")} className={toolBtn(marks.bold)}>
          <Bold size={15} />
        </button>
        <button type="button" disabled={disabled} title={t("form.editor_italic")} aria-label={t("form.editor_italic")} onClick={() => exec("italic")} className={toolBtn(marks.italic)}>
          <Italic size={15} />
        </button>
        <button type="button" disabled={disabled} title={t("form.editor_underline")} aria-label={t("form.editor_underline")} onClick={() => exec("underline")} className={toolBtn(marks.underline)}>
          <Underline size={15} />
        </button>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
        <button
          type="button"
          disabled={disabled}
          title={t("form.editor_block")}
          aria-label={`${t("form.editor_block")}: ${BLOCK_STEPS[blockIndex] === "p" ? t("form.editor_paragraph") : `${t("form.editor_heading")} ${BLOCK_STEPS[blockIndex].slice(1)}`}`}
          onClick={cycleBlock}
          className={`${toolBtn(false)} min-w-8 px-1 text-[11px] font-black`}
        >
          {BLOCK_STEPS[blockIndex] === "p" ? "P" : BLOCK_STEPS[blockIndex].toUpperCase()}
        </button>
        <button
          type="button"
          disabled={disabled}
          title={t("form.editor_font_size")}
          aria-label={`${t("form.editor_font_size")}: ${t(SIZE_STEPS[sizeIndex].labelKey)}`}
          onClick={cycleSize}
          className={`${toolBtn(false)} min-w-8 px-1 text-[11px] font-black`}
        >
          A{t(["S", "M", "L", "XL"][sizeIndex])}
        </button>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
        <button type="button" disabled={disabled} title={t("form.editor_bullets")} aria-label={t("form.editor_bullets")} onClick={() => exec("insertUnorderedList")} className={toolBtn(marks.ul)}>
          <List size={15} />
        </button>
        <button type="button" disabled={disabled} title={t("form.editor_numbered")} aria-label={t("form.editor_numbered")} onClick={() => exec("insertOrderedList")} className={toolBtn(marks.ol)}>
          <ListOrdered size={15} />
        </button>
        <button type="button" disabled={disabled} title={t("form.editor_link")} aria-label={t("form.editor_link")} onClick={openLinkBar} className={toolBtn(false)}>
          <Link2 size={15} />
        </button>
        <button
          type="button"
          disabled={disabled || uploading}
          title={t("form.editor_image")}
          aria-label={t("form.editor_image")}
          onClick={() => fileRef.current?.click()}
          className={toolBtn(false)}
        >
          {uploading ? <Loader2 size={15} className="animate-spin" /> : <ImagePlus size={15} />}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept={IMAGE_TYPES.join(",")}
          className="hidden"
          tabIndex={-1}
          onChange={(event) => {
            void handleImageFile(event.currentTarget.files?.[0]);
            event.currentTarget.value = "";
          }}
        />
        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
        <button type="button" disabled={disabled} title={t("form.editor_align_left")} aria-label={t("form.editor_align_left")} onClick={() => exec("justifyLeft")} className={toolBtn(false)}>
          <AlignLeft size={15} />
        </button>
        <button type="button" disabled={disabled} title={t("form.editor_align_center")} aria-label={t("form.editor_align_center")} onClick={() => exec("justifyCenter")} className={toolBtn(false)}>
          <AlignCenter size={15} />
        </button>
        <button type="button" disabled={disabled} title={t("form.editor_align_right")} aria-label={t("form.editor_align_right")} onClick={() => exec("justifyRight")} className={toolBtn(false)}>
          <AlignRight size={15} />
        </button>
        <button type="button" disabled={disabled} title={t("form.editor_align_justify")} aria-label={t("form.editor_align_justify")} onClick={() => exec("justifyFull")} className={toolBtn(false)}>
          <AlignJustify size={15} />
        </button>
        <button type="button" disabled={disabled} title={t("form.editor_clear")} aria-label={t("form.editor_clear")} onClick={() => exec("removeFormat")} className={toolBtn(false)}>
          <RemoveFormatting size={15} />
        </button>
      </div>

      {linkOpen && (
        <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-2 py-1.5" onMouseDown={keepSelection}>
          <input
            autoFocus
            dir="ltr"
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.currentTarget.value)}
            placeholder="https://…"
            className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-background px-2 text-xs outline-none focus:border-ring"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                applyLink();
              }
              if (event.key === "Escape") setLinkOpen(false);
            }}
          />
          <button
            type="button"
            onClick={applyLink}
            className="h-8 shrink-0 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground"
          >
            {t("form.editor_link_apply")}
          </button>
        </div>
      )}

      <div
        ref={editorRef}
        contentEditable={!disabled}
        suppressContentEditableWarning
        dir="auto"
        data-placeholder={placeholder ?? ""}
        onInput={emit}
        onKeyUp={refreshMarks}
        onMouseUp={refreshMarks}
        className="product-rich min-h-28 px-3 py-2.5 text-sm text-foreground outline-none empty:before:font-normal empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]"
      />
    </div>
  );
}
