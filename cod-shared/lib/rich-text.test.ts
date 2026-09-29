/**
 * Node-compatible rich-text tests.
 *
 * Upstream runs these inside workerd (Miniflare) because the implementation
 * used Cloudflare's HTMLRewriter. This tree runs on Node (Vercel/Neon), so
 * `cod-shared/lib/rich-text.ts` is a dependency-free port of the same
 * allow-list contract — and these tests pin that contract directly:
 * allow-list basics, XSS removal, attribute rules, tail truncation,
 * byte-for-byte template survival, and plain-text derivation.
 */

import { describe, expect, it } from "vitest";
import {
  RICH_TEXT_MAX_CHARS,
  sanitizeRichText,
  toPlainText,
  unsupportedElements,
} from "./rich-text";

describe("sanitizeRichText — allow-list", () => {
  it("keeps allowed formatting untouched", async () => {
    const html =
      '<p>Hello <strong>world</strong>, <em>yes</em> <a href="https://example.com">link</a></p>';
    const { html: out, removed } = await sanitizeRichText(html);
    expect(out).toBe(
      '<p>Hello <strong>world</strong>, <em>yes</em> <a href="https://example.com" rel="noopener noreferrer nofollow" target="_blank">link</a></p>',
    );
    expect(removed).toEqual([]);
  });

  it("drops script/style/iframe with their content", async () => {
    const { html: out, removed } = await sanitizeRichText(
      '<p>keep</p><script>alert(1)</script><style>.x{}</style><p>kept</p>',
    );
    expect(out).toBe("<p>keep</p><p>kept</p>");
    expect(removed.map((r) => r.name)).toEqual(["script", "style"]);
  });

  it("unwraps unknown elements but keeps their text", async () => {
    const { html: out, removed } = await sanitizeRichText(
      "<p>hi <foo>there</foo></p>",
    );
    expect(out).toBe("<p>hi there</p>");
    expect(removed).toEqual([{ kind: "element", name: "foo" }]);
  });

  it("strips event handlers, javascript: hrefs and unknown attrs", async () => {
    const { html: out } = await sanitizeRichText(
      '<p onclick="evil()">x</p><a href="javascript:alert(1)">y</a><a href="https://ok.example/z">z</a>',
    );
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("javascript:");
    expect(out).toContain('href="https://ok.example/z"');
  });

  it("drops http img srcs and keeps https ones", async () => {
    const { html: out } = await sanitizeRichText(
      '<img src="http://x.example/a.png"><img src="https://x.example/b.png" alt="b">',
    );
    expect(out).not.toContain("http://x.example/a.png");
    expect(out).toContain('src="https://x.example/b.png"');
  });

  it("removes comments", async () => {
    const { html: out, removed } = await sanitizeRichText(
      "<p>a</p><!-- hi --><p>b</p>",
    );
    expect(out).toBe("<p>a</p><p>b</p>");
    expect(removed).toEqual([{ kind: "comment", name: "comment" }]);
  });

  it("truncates an unterminated tag tail", async () => {
    const { html: out } = await sanitizeRichText(
      '<p>ok</p><img src="https://m.example/i.jpg" onerror=alert(1)',
    );
    expect(out).toBe("<p>ok</p>");
  });

  it("keeps a text '<' at EOF and unclosed elements verbatim", async () => {
    expect((await sanitizeRichText("<p>5 < 10</p>")).html).toBe("<p>5 < 10</p>");
    expect((await sanitizeRichText("<b>bold")).html).toBe("<b>bold");
    expect((await sanitizeRichText("<p>done</p><")).html).toBe("<p>done</p><");
  });

  it("keeps task-list data attributes and text-align styles", async () => {
    const { html: out } = await sanitizeRichText(
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="true">done</li></ul><p style="text-align: center">c</p>',
    );
    expect(out).toContain('data-type="taskList"');
    expect(out).toContain('data-checked="true"');
    expect(out).toContain('style="text-align: center"');
  });

  it("rejects style values outside the fixed patterns", async () => {
    const { html: out, removed } = await sanitizeRichText(
      '<p style="color: red">x</p>',
    );
    expect(out).toBe("<p>x</p>");
    expect(removed.some((r) => r.kind === "attribute" && r.name === "style")).toBe(true);
  });
});

describe("unsupportedElements", () => {
  it("lists what would be removed without changing the input", async () => {
    const removed = await unsupportedElements('<p>a</p><script>b</script>');
    expect(removed.map((r) => r.name)).toEqual(["script"]);
  });
});

describe("toPlainText", () => {
  it("separates blocks and decodes entities", async () => {
    expect(await toPlainText("<p>Hello</p><p>World</p>")).toBe("Hello World");
    expect(await toPlainText("<p>a<br>b</p>")).toBe("a b");
    expect(await toPlainText("<p>5 &lt; 6 &amp; 7</p>")).toBe("5 < 6 & 7");
  });

  it("returns tag-free text for lists and headings", async () => {
    const plain = await toPlainText("<h2>Title</h2><ul><li>one</li><li>two</li></ul>");
    expect(plain).toBe("Title one two");
    expect(plain).not.toMatch(/<[^>]+>/);
  });
});

describe("contract constants", () => {
  it("exposes the shared character cap", () => {
    expect(RICH_TEXT_MAX_CHARS).toBe(100_000);
  });
});
