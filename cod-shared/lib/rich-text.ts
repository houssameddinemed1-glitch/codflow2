export type RichTextRemovalKind = "element" | "attribute" | "comment";

export interface RichTextRemoval {
  kind: RichTextRemovalKind;
  name: string;
  tag?: string;
  value?: string;
}

export interface SanitizeRichTextResult {
  html: string;
  removed: RichTextRemoval[];
}

/**
 * The hard cap on a stored description, in characters.
 *
 * Part of the rich-text contract, so it lives with the allow-list rather than
 * in any one consumer: the products API rejects anything longer, and the
 * dashboard editor counts against the same number so a merchant is stopped
 * before the request rather than after it.
 */
export const RICH_TEXT_MAX_CHARS = 100_000;

export const RICH_TEXT_TAGS = {
  text: ["p", "br", "hr", "strong", "b", "em", "i", "u", "s", "strike", "sub", "sup", "code", "pre"],
  headings: ["h2", "h3", "h4", "h5", "h6"],
  lists: ["ul", "ol", "li", "blockquote"],
  links: ["a"],
  media: ["img", "figure", "figcaption"],
  highlight: ["mark"],
  tables: ["table", "thead", "tbody", "tfoot", "tr", "th", "td"],
} as const satisfies Record<string, readonly string[]>;

export const RICH_TEXT_ATTRS: Readonly<Record<string, readonly string[]>> = {
  a: ["href", "title"],
  img: ["src", "alt", "width", "height"],
  td: ["colspan", "rowspan", "scope", "headers"],
  th: ["colspan", "rowspan", "scope", "headers"],
  ul: ["data-type"],
  li: ["data-type", "data-checked"],
};

/**
 * The only inline `style` a stored description may keep.
 *
 * Both entries exist because the editor template emits them and the storefront
 * renders them: text alignment (TextAlign) and the highlight colour (Highlight).
 * Each is a fixed pattern matched against the WHOLE value, so `style` never
 * becomes a general escape hatch back into the markup: a highlight carries one
 * background colour and nothing else, and the storefront theme sets the text
 * colour on top of it.
 *
 * A highlight arrives as `rgb()` as often as a hex, and both have to be kept.
 * ProseMirror's DOM serializer assigns the style through `dom.style.cssText`
 * rather than `setAttribute`, so a browser re-serialises the declaration from
 * its CSSOM and `#dcfce7` comes back out as `rgb(220, 252, 231)`. Accepting
 * only the hex dropped every highlight saved from the dashboard, which left a
 * bare `<mark>` rendering as the browser's default yellow. The colour functions
 * take digits and separators only — no identifier can appear inside the
 * parentheses, so `url(`, `var(` and `expression(` still cannot get through.
 */
const CSS_COLOR = /(?:#[0-9a-f]{3,8}|rgba?\([0-9.,%\s/]+\))/.source;

export const RICH_TEXT_STYLE_PATTERNS: Readonly<Record<string, RegExp>> = {
  p: /^text-align:\s*(left|center|right|justify)\s*;?$/i,
  h2: /^text-align:\s*(left|center|right|justify)\s*;?$/i,
  h3: /^text-align:\s*(left|center|right|justify)\s*;?$/i,
  h4: /^text-align:\s*(left|center|right|justify)\s*;?$/i,
  h5: /^text-align:\s*(left|center|right|justify)\s*;?$/i,
  h6: /^text-align:\s*(left|center|right|justify)\s*;?$/i,
  mark: new RegExp(`^background-color:\\s*${CSS_COLOR}\\s*;?$`, "i"),
};

/** Fixed value sets for the `data-*` attributes the editor template writes. */
export const RICH_TEXT_DATA_VALUES: Readonly<
  Record<string, Readonly<Record<string, readonly string[]>>>
> = {
  ul: { "data-type": ["taskList"] },
  li: { "data-type": ["taskItem"], "data-checked": ["true", "false"] },
};

export const RICH_TEXT_SCHEMES = ["https", "http", "mailto", "tel"] as const;

export const RICH_TEXT_DANGEROUS_TAGS = [
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "svg",
  "math",
  "form",
] as const;

const ALLOWED_TAGS: ReadonlySet<string> = new Set(
  Object.values(RICH_TEXT_TAGS).flat()
);
const DANGEROUS_TAGS: ReadonlySet<string> = new Set(RICH_TEXT_DANGEROUS_TAGS);
const INTEGER_ATTRS: ReadonlySet<string> = new Set([
  "width",
  "height",
  "colspan",
  "rowspan",
]);
const HEX_COLOR_RE = /^#[0-9a-f]{3,8}$/i;
const SCOPE_VALUES: ReadonlySet<string> = new Set([
  "row",
  "col",
  "rowgroup",
  "colgroup",
]);
const FORBIDDEN_ATTRS: ReadonlySet<string> = new Set(["style", "class", "id"]);
const FORCED_ATTRS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  a: { rel: "noopener noreferrer nofollow", target: "_blank" },
  img: { loading: "lazy", decoding: "async", referrerpolicy: "no-referrer" },
};
const REMOVAL_VALUE_CAP = 200;

interface ParsedAttr {
  name: string;
  /** null = valueless (bare) attribute in source. */
  value: string | null;
}

interface ParsedTag {
  closing: boolean;
  /** Lower-cased tag name. */
  name: string;
  attrs: ParsedAttr[];
  selfClosing: boolean;
}

/**
 * Split one `<...>` token (without the brackets) into its parts.
 * Returns null for bogus markup (`<!...>`, `<?...?>`), which callers drop.
 */
function parseTag(inner: string): ParsedTag | null {
  let s = inner.trim();
  if (s.startsWith("!") || s.startsWith("?")) return null;
  let closing = false;
  if (s.startsWith("/")) {
    closing = true;
    s = s.slice(1).trim();
  }
  let selfClosing = false;
  if (!closing && s.endsWith("/")) {
    selfClosing = true;
    s = s.slice(0, -1).trim();
  }
  const nameMatch = /^[A-Za-z][A-Za-z0-9-]*/.exec(s);
  if (!nameMatch) return null;
  const name = nameMatch[0].toLowerCase();
  const attrs: ParsedAttr[] = [];
  let rest = s.slice(nameMatch[0].length);
  const attrRe =
    /\s*([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(rest)) !== null) {
    if (m[0].length === 0) break;
    const attrName = m[1].toLowerCase();
    const value =
      m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4];
    if (!attrs.some((a) => a.name === attrName)) {
      attrs.push({ name: attrName, value: value ?? null });
    }
  }
  return { closing, name, attrs, selfClosing };
}

function escapeAttrValue(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

/** Void elements never take an end tag in serialised output. */
const VOID_TAGS: ReadonlySet<string> = new Set([
  "br",
  "hr",
  "img",
  "col",
  "source",
  "wbr",
]);

class AllowListState {
  readonly removals: RichTextRemoval[] = [];
  readonly out: string[] = [];
  private readonly openStack: string[] = [];
  private dropTag: string | null = null;
  private dropDepth = 0;

  private emitStartTag(
    tag: string,
    attrs: Array<[string, string]>,
    selfClosing: boolean,
  ): void {
    const attrText = attrs
      .map(([name, value]) => ` ${name}="${escapeAttrValue(value)}"`)
      .join("");
    this.out.push(`<${tag}${attrText}>`);
    if (!selfClosing && !VOID_TAGS.has(tag)) this.openStack.push(tag);
  }

  private emitEndTag(tag: string): void {
    const idx = this.openStack.lastIndexOf(tag);
    if (idx === -1) return;
    while (this.openStack.length > idx) {
      const open = this.openStack.pop()!;
      this.out.push(`</${open}>`);
    }
  }

  text(chunk: string): void {
    if (this.dropTag !== null) return;
    this.out.push(chunk);
  }

  comment(): void {
    if (this.dropTag !== null) return;
    this.removals.push({ kind: "comment", name: "comment" });
  }

  element(tag: ParsedTag): void {
    if (this.dropTag !== null) {
      if (!tag.closing && tag.name === this.dropTag) this.dropDepth += 1;
      if (tag.closing && tag.name === this.dropTag) {
        this.dropDepth -= 1;
        if (this.dropDepth <= 0) {
          this.dropTag = null;
          this.dropDepth = 0;
        }
      }
      return;
    }
    if (tag.closing) {
      if (ALLOWED_TAGS.has(tag.name)) this.emitEndTag(tag.name);
      return;
    }
    if (DANGEROUS_TAGS.has(tag.name)) {
      this.removals.push({ kind: "element", name: tag.name });
      if (!tag.selfClosing && !VOID_TAGS.has(tag.name)) {
        this.dropTag = tag.name;
        this.dropDepth = 1;
      }
      return;
    }
    if (!ALLOWED_TAGS.has(tag.name)) {
      this.removals.push({ kind: "element", name: tag.name });
      return;
    }
    const forced = FORCED_ATTRS[tag.name] ?? {};
    const kept: Array<[string, string]> = [];
    for (const { name, value } of tag.attrs) {
      if (name in forced) continue;
      if (!isAllowedAttribute(tag.name, name, value ?? "")) {
        this.removals.push({
          kind: "attribute",
          name,
          tag: tag.name,
          value: (value ?? "").slice(0, REMOVAL_VALUE_CAP),
        });
        continue;
      }
      kept.push([name, value ?? ""]);
    }
    for (const [name, value] of Object.entries(forced)) {
      kept.push([name, value]);
    }
    this.emitStartTag(tag.name, kept, tag.selfClosing);
  }

  finish(): string {
    // No auto-close: like the streaming parser this ports, an element left
    // open at EOF stays open — truncateUnterminatedTail decides the tail.
    // (Auto-closing would hide the bare `<` the tail check looks for.)
    this.openStack.length = 0;
    return this.out.join("");
  }
}

const TAG_TOKEN_RE =
  /<!--[\s\S]*?-->|<\/?[A-Za-z][^<>]*>|<![^<>]*>|<\?[^<>]*\?>/g;

async function runAllowList(
  html: string
): Promise<{ html: string; removed: RichTextRemoval[] }> {
  const state = new AllowListState();
  let pos = 0;
  TAG_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_TOKEN_RE.exec(html)) !== null) {
    if (m.index > pos) state.text(html.slice(pos, m.index));
    const token = m[0];
    pos = m.index + token.length;
    if (token.startsWith("<!--")) {
      state.comment();
      continue;
    }
    const parsed = parseTag(token.slice(1, -1));
    if (!parsed) continue;
    state.element(parsed);
  }
  if (pos < html.length) state.text(html.slice(pos));
  return { html: state.finish(), removed: state.removals };
}

function isForbiddenAttrName(name: string): boolean {
  return (
    name.startsWith("on") ||
    name.startsWith("data-") ||
    FORBIDDEN_ATTRS.has(name)
  );
}

/**
 * Whether one attribute on one tag survives.
 *
 * `style` and `data-*` are not generally allowed — each is decided per tag
 * against a fixed pattern or a fixed value set, which is what keeps the widened
 * allow-list (text alignment, highlight colour, task lists) from becoming a way
 * back into arbitrary markup.
 */
function isAllowedAttribute(tag: string, attr: string, value: string): boolean {
  if (attr === "style") {
    const pattern = RICH_TEXT_STYLE_PATTERNS[tag];
    return pattern !== undefined && pattern.test(decodeEntities(value).trim());
  }
  if (attr === "data-color") {
    // A highlight stores the colour it will render with; a theme variable here
    // would render nowhere in the storefront, so only a hex is accepted.
    return tag === "mark" && HEX_COLOR_RE.test(value.trim());
  }
  if (attr.startsWith("data-")) {
    const values = RICH_TEXT_DATA_VALUES[tag]?.[attr];
    // Exact match: attribute values are case-sensitive, and the editor writes
    // these two exactly ("taskList" / "taskItem").
    return values !== undefined && values.includes(value);
  }
  if (isForbiddenAttrName(attr)) return false;
  const allowed = RICH_TEXT_ATTRS[tag];
  if (allowed === undefined || !allowed.includes(attr)) return false;
  return isValidAttrValue(attr, decodeEntities(value));
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00A0",
  colon: ":",
  semi: ";",
  plus: "+",
  period: ".",
  hyphen: "-",
  dash: "-",
  minus: "-",
  Tab: "\t",
  NewLine: "\n",
};

function decodeEntities(input: string): string {
  if (!input.includes("&")) return input;
  return input.replace(
    /&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);?/g,
    (raw, body: string) => {
      if (body[0] === "#") {
        const code =
          body[1] === "x" || body[1] === "X"
            ? parseInt(body.slice(2), 16)
            : parseInt(body.slice(1), 10);
        if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return raw;
        try {
          return String.fromCodePoint(code);
        } catch {
          return raw;
        }
      }
      return NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()] ?? raw;
    }
  );
}

const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.\-]*):/;

function urlScheme(value: string): string | null {
  const cleaned = value
    .replace(/^[\u0000-\u0020\u007F]+/, "")
    .replace(/[\u0000-\u0020\u007F]+$/, "")
    .replace(/[\t\n\r]/g, "");
  const match = SCHEME_RE.exec(cleaned);
  return match ? match[1].toLowerCase() : null;
}

function isAllowedHref(value: string): boolean {
  const scheme = urlScheme(value);
  if (scheme === null) return true;
  return (RICH_TEXT_SCHEMES as readonly string[]).includes(scheme.toLowerCase());
}

function isHttpsSrc(value: string): boolean {
  return urlScheme(value) === "https";
}

function isValidAttrValue(attr: string, value: string): boolean {
  if (INTEGER_ATTRS.has(attr)) return /^[1-9][0-9]*$/.test(value);
  if (attr === "scope") return SCOPE_VALUES.has(value.toLowerCase());
  if (attr === "headers") {
    const tokens = value.split(/\s+/).filter(Boolean);
    return (
      tokens.length > 0 &&
      tokens.every((t) => /^[A-Za-z][A-Za-z0-9_.:\-]*$/.test(t))
    );
  }
  if (attr === "href") return isAllowedHref(value);
  if (attr === "src") return isHttpsSrc(value);
  return true;
}

function truncateUnterminatedTail(html: string): string {
  const last = html.lastIndexOf("<");
  if (last === -1) return html;
  const tail = html.slice(last);
  if (tail.includes(">")) return html;
  if (/^<\/?[a-zA-Z]/.test(tail) || tail.startsWith("<!") || tail.startsWith("<?")) {
    return html.slice(0, last);
  }
  return html;
}

export async function sanitizeRichText(
  html: string
): Promise<SanitizeRichTextResult> {
  const { html: sanitized, removed } = await runAllowList(html);
  return { html: truncateUnterminatedTail(sanitized), removed };
}

export async function unsupportedElements(
  html: string
): Promise<RichTextRemoval[]> {
  return (await runAllowList(html)).removed;
}

const BLOCK_TAGS: ReadonlySet<string> = new Set([
  "p",
  "br",
  "hr",
  "li",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "figcaption",
  "tr",
  "pre",
  "figure",
]);

// Void blocks never emit an end tag — registering onEndTag on them makes the
// parser throw "No end tag".
const VOID_BLOCK_TAGS: ReadonlySet<string> = new Set(["br", "hr"]);

export async function toPlainText(html: string): Promise<string> {
  let text = "";
  TAG_TOKEN_RE.lastIndex = 0;
  let pos = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_TOKEN_RE.exec(html)) !== null) {
    if (m.index > pos) text += decodeEntities(html.slice(pos, m.index));
    const token = m[0];
    pos = m.index + token.length;
    if (token.startsWith("<!--")) continue;
    const parsed = parseTag(token.slice(1, -1));
    if (!parsed) continue;
    if (BLOCK_TAGS.has(parsed.name)) {
      // Blocks separate content on BOTH sides: a start-tag space covers
      // the block's own first text; an end-tag space separates inline
      // content that follows the block. Void blocks (br/hr) only have a
      // start tag.
      text += " ";
    }
  }
  if (pos < html.length) text += decodeEntities(html.slice(pos));
  return text.replace(/\s+/g, " ").trim();
}
