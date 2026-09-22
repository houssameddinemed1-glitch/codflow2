/**
 * Minimal strict HTML sanitizer for merchant-authored rich text (product
 * descriptions). Dependency-free on purpose — it runs in cod-server and in
 * unit tests without a DOM.
 *
 * Policy:
 * - Allowlist of formatting tags only (p, headings, bold/italic/underline,
 *   lists, links, images, plain spans/divs, line breaks).
 * - Dangerous tags (script, style, iframe, svg, …) are dropped WITH content.
 * - Unknown tags are unwrapped (children kept).
 * - Attributes are allowlisted per tag; `on*` handlers can never survive
 *   because only named attributes are ever emitted.
 * - URLs: a[href] allows http/https/mailto/relative; img[src] allows https
 *   only. Entity-encoded tricks (`&#106;avascript:`) are decoded before the
 *   scheme check.
 * - style="" keeps ONLY text-align and bounded font-size; everything else
 *   (position, background-url, …) is dropped.
 */

const ALLOWED_TAGS = new Set([
  "p", "br", "h1", "h2", "h3",
  "strong", "b", "em", "i", "u",
  "ul", "ol", "li",
  "a", "img", "span", "div",
]);

/** Dropped WITH their content — never unwrapped. */
const DROP_WITH_CONTENT = new Set([
  "script", "style", "iframe", "object", "embed", "applet",
  "form", "input", "button", "textarea", "select", "option",
  "link", "meta", "base", "title", "frame", "frameset",
  "video", "audio", "source", "track", "canvas", "svg", "math",
]);

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "source", "track", "wbr",
]);

const ENTITY_MAP: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
};

/** Decode HTML entities (named + decimal/hex numeric) so scheme checks see the real value. */
function decodeEntities(value: string): string {
  return value.replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X"
        ? parseInt(entity.slice(2), 16)
        : parseInt(entity.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return ENTITY_MAP[entity] ?? match;
  });
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}

/** Strip ASCII whitespace/control chars for scheme checks (`java\tscript:` tricks). */
function schemeOf(url: string): string {
  const cleaned = url.replace(/[\u0000-\u0020]+/g, "").toLowerCase();
  const colon = cleaned.indexOf(":");
  return colon === -1 ? "" : cleaned.slice(0, colon);
}

function allowedHref(raw: string): string | null {
  const url = decodeEntities(raw).trim();
  if (!url) return null;
  const scheme = schemeOf(url);
  if (scheme === "" || scheme === "http" || scheme === "https" || scheme === "mailto") {
    return url;
  }
  return null;
}

function allowedImgSrc(raw: string): string | null {
  const url = decodeEntities(raw).trim();
  if (!url) return null;
  const scheme = schemeOf(url);
  // https only — blocks javascript:, data:, and insecure http embeds.
  if (scheme === "https") return url;
  return null;
}

function filterStyle(raw: string): string | null {
  const kept: string[] = [];
  for (const declaration of raw.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon === -1) continue;
    const prop = declaration.slice(0, colon).trim().toLowerCase();
    const val = declaration.slice(colon + 1).trim().toLowerCase();
    if (prop === "text-align" && ["left", "center", "right", "justify"].includes(val)) {
      kept.push(`text-align: ${val}`);
    } else if (prop === "font-size") {
      const px = val.match(/^(\d+(?:\.\d+)?)px$/);
      if (px) {
        const size = Number(px[1]);
        if (size >= 8 && size <= 72) kept.push(`font-size: ${size}px`);
      }
    }
  }
  return kept.length > 0 ? kept.join("; ") : null;
}

interface ParsedTag {
  closing: boolean;
  name: string;
  attrs: Array<{ name: string; value: string }>;
  selfClosing: boolean;
}

/** Parse one `<…>` starting at html[i] === "<". Returns null for malformed input (treat as text). */
function parseTag(html: string, i: number): { tag: ParsedTag; end: number } | null {
  let j = i + 1;
  const closing = html[j] === "/";
  if (closing) j++;
  // A tag open must start with an ASCII letter — "<3", "< 3" etc. are text.
  if (!/[a-zA-Z]/.test(html[j] ?? "")) return null;
  const nameStart = j;
  while (j < html.length && /[a-zA-Z0-9]/.test(html[j]!)) j++;
  const name = html.slice(nameStart, j).toLowerCase();
  if (!name) return null;
  const attrs: Array<{ name: string; value: string }> = [];
  let selfClosing = false;
  while (j < html.length) {
    while (j < html.length && /\s/.test(html[j]!)) j++;
    if (j >= html.length) return null;
    if (html[j] === ">") { j++; break; }
    if (html[j] === "/" && html[j + 1] === ">") { selfClosing = true; j += 2; break; }
    const attrStart = j;
    while (j < html.length && /[^\s=/>]/.test(html[j]!)) j++;
    const attrName = html.slice(attrStart, j).toLowerCase();
    if (!attrName) { j++; continue; }
    while (j < html.length && /\s/.test(html[j]!)) j++;
    let attrValue = "";
    if (html[j] === "=") {
      j++;
      while (j < html.length && /\s/.test(html[j]!)) j++;
      const quote = html[j];
      if (quote === '"' || quote === "'") {
        j++;
        const valueStart = j;
        while (j < html.length && html[j] !== quote) j++;
        attrValue = html.slice(valueStart, j);
        if (html[j] === quote) j++;
      } else {
        const valueStart = j;
        while (j < html.length && !/[\s>]/.test(html[j]!)) j++;
        attrValue = html.slice(valueStart, j);
      }
    }
    attrs.push({ name: attrName, value: attrValue });
  }
  return { tag: { closing, name, attrs, selfClosing }, end: j };
}

/**
 * Sanitize merchant HTML to the formatting allowlist. Plain text passes
 * through (escaped). Never throws — worst case returns "".
 */
export function sanitizeRichText(input: string | null | undefined): string {
  if (!input) return "";
  const html = String(input);
  let out = "";
  const openStack: string[] = [];
  let dropDepth = 0;
  let dropTag = "";
  let i = 0;

  while (i < html.length) {
    // Comments are stripped outright.
    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html[i] !== "<") {
      const next = html.indexOf("<", i);
      const text = next === -1 ? html.slice(i) : html.slice(i, next);
      if (dropDepth === 0) out += escapeText(text);
      i = next === -1 ? html.length : next;
      continue;
    }
    const parsed = parseTag(html, i);
    if (!parsed) {
      if (dropDepth === 0) out += "&lt;";
      i++;
      continue;
    }
    i = parsed.end;
    const { closing, name, attrs, selfClosing } = parsed.tag;

    // Inside a dropped subtree: track nesting of the same tag only.
    if (dropDepth > 0) {
      if (!closing && name === dropTag && !VOID_ELEMENTS.has(name)) dropDepth++;
      if (closing && name === dropTag) dropDepth--;
      continue;
    }

    if (DROP_WITH_CONTENT.has(name)) {
      if (!closing && !selfClosing && !VOID_ELEMENTS.has(name)) {
        dropDepth = 1;
        dropTag = name;
      }
      continue;
    }

    if (!ALLOWED_TAGS.has(name)) {
      // Unknown tag: unwrap (keep children). Closing tags of unknown
      // elements are ignored; void unknowns vanish.
      continue;
    }

    if (closing) {
      const idx = openStack.lastIndexOf(name);
      if (idx !== -1) {
        while (openStack.length > idx) {
          out += `</${openStack.pop()}>`;
        }
      }
      continue;
    }

    if (name === "br") {
      out += "<br>";
      continue;
    }

    let attrOut = "";
    if (name === "a") {
      const href = attrs.find((a) => a.name === "href");
      const clean = href ? allowedHref(href.value) : null;
      if (clean === null) {
        // Link without a safe destination: unwrap, keep the text.
        continue;
      }
      attrOut = ` href="${escapeAttr(clean)}" target="_blank" rel="noopener noreferrer"`;
    } else if (name === "img") {
      const src = attrs.find((a) => a.name === "src");
      const clean = src ? allowedImgSrc(src.value) : null;
      if (clean === null) continue; // drop imageless/bait <img>
      attrOut = ` src="${escapeAttr(clean)}"`;
      const alt = attrs.find((a) => a.name === "alt");
      if (alt) attrOut += ` alt="${escapeAttr(decodeEntities(alt.value))}"`;
    } else if (name === "span" || name === "div" || name === "p" || name === "h1" || name === "h2" || name === "h3" || name === "li") {
      const style = attrs.find((a) => a.name === "style");
      const clean = style ? filterStyle(decodeEntities(style.value)) : null;
      if (clean) attrOut = ` style="${escapeAttr(clean)}"`;
    }

    out += `<${name}${attrOut}>`;
    if (!selfClosing && !VOID_ELEMENTS.has(name)) openStack.push(name);
  }

  while (openStack.length > 0) {
    out += `</${openStack.pop()}>`;
  }
  return out;
}
