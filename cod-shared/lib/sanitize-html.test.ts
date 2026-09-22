import { describe, it, expect } from "vitest";
import { sanitizeRichText } from "./sanitize-html";

describe("sanitizeRichText", () => {
  it("returns empty for nullish input", () => {
    expect(sanitizeRichText(null)).toBe("");
    expect(sanitizeRichText(undefined)).toBe("");
    expect(sanitizeRichText("")).toBe("");
  });

  it("passes plain text through escaped", () => {
    expect(sanitizeRichText("Cotton & wool <3")).toBe("Cotton &amp; wool &lt;3");
  });

  it("keeps the formatting allowlist", () => {
    const html = "<p><strong>Bold</strong> <em>it</em> <u>u</u></p><h2>Title</h2><ul><li>one</li></ul><ol><li>two</li></ol><br>";
    expect(sanitizeRichText(html)).toBe(html);
  });

  it("drops script/style/iframe WITH their content", () => {
    expect(sanitizeRichText("a<script>alert(1)</script>b")).toBe("ab");
    expect(sanitizeRichText("a<style>p{color:red}</style>b")).toBe("ab");
    expect(sanitizeRichText('a<iframe src="https://x"></iframe>b')).toBe("ab");
    expect(sanitizeRichText("a<svg><circle/></svg>b")).toBe("ab");
  });

  it("strips event handlers and unknown attributes", () => {
    expect(sanitizeRichText('<p onclick="alert(1)" class="x">hi</p>')).toBe("<p>hi</p>");
    expect(sanitizeRichText('<img src="https://cdn.example/i.png" onerror="alert(1)">')).toBe(
      '<img src="https://cdn.example/i.png">'
    );
  });

  it("blocks javascript: hrefs including entity-encoded tricks, keeps text", () => {
    expect(sanitizeRichText('<a href="javascript:alert(1)">click</a>')).toBe("click");
    expect(sanitizeRichText('<a href="&#106;avascript:alert(1)">click</a>')).toBe("click");
    expect(sanitizeRichText('<a href="java\tscript:alert(1)">click</a>')).toBe("click");
  });

  it("keeps safe links and forces safe browsing context", () => {
    expect(sanitizeRichText('<a href="https://shop.example/p">p</a>')).toBe(
      '<a href="https://shop.example/p" target="_blank" rel="noopener noreferrer">p</a>'
    );
    expect(sanitizeRichText('<a href="/products/x">x</a>')).toBe(
      '<a href="/products/x" target="_blank" rel="noopener noreferrer">x</a>'
    );
    expect(sanitizeRichText('<a href="mailto:a@b.dz">m</a>')).toBe(
      '<a href="mailto:a@b.dz" target="_blank" rel="noopener noreferrer">m</a>'
    );
  });

  it("blocks data: and http image sources", () => {
    expect(sanitizeRichText('<img src="data:image/png;base64,AAA">')).toBe("");
    expect(sanitizeRichText('<img src="http://cdn.example/i.png">')).toBe("");
    expect(sanitizeRichText('<img src="https://cdn.example/i.png" alt="shoe">')).toBe(
      '<img src="https://cdn.example/i.png" alt="shoe">'
    );
  });

  it("filters style to text-align and bounded font-size only", () => {
    expect(sanitizeRichText('<p style="text-align: center; color: red; position: absolute">x</p>')).toBe(
      '<p style="text-align: center">x</p>'
    );
    expect(sanitizeRichText('<span style="font-size: 24px">x</span>')).toBe(
      '<span style="font-size: 24px">x</span>'
    );
    expect(sanitizeRichText('<span style="font-size: 200px">x</span>')).toBe("<span>x</span>");
    expect(sanitizeRichText('<span style="background: url(javascript:alert(1))">x</span>')).toBe("<span>x</span>");
  });

  it("unwraps unknown tags but keeps their content", () => {
    expect(sanitizeRichText('<font size="4">big</font>')).toBe("big");
    expect(sanitizeRichText("<div><section><p>deep</p></section></div>")).toBe("<div><p>deep</p></div>");
  });

  it("strips comments", () => {
    expect(sanitizeRichText("a<!-- secret -->b")).toBe("ab");
  });

  it("auto-closes unbalanced tags", () => {
    expect(sanitizeRichText("<p><strong>x")).toBe("<p><strong>x</strong></p>");
  });
});
