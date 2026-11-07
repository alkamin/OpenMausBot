// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatMarkdown } from "./ChatMarkdown";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const render = (text: string) => renderToStaticMarkup(createElement(ChatMarkdown, { text }));

describe("native response components", () => {
  it.each(["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"])("renders a %s callout with Markdown content", (kind) => {
    const html = render(`> [!${kind}]\n> Keep **this** visible.\n>\n> - First\n> - Second`);
    expect(html).toContain(`data-response-callout="${kind}"`);
    expect(html).toContain('role="note"');
    expect(html).toContain("<strong>this</strong>");
    expect(html).toContain("<li>First</li>");
    expect(html).not.toContain(`[!${kind}]`);
  });

  it("leaves ordinary quotes, unknown callouts and markers inside code alone", () => {
    expect(render("> A normal quote")).toContain("<blockquote");
    expect(render("> [!UNKNOWN]\n> Keep the words.")).toContain("[!UNKNOWN]");
    const code = render("```text\n> [!TIP]\n<details>\n<summary>Example</summary>\n\nbody\n\n</details>\n```");
    expect(code).not.toContain('data-response-callout="TIP"');
    expect(code).not.toContain("data-response-details");
  });

  it("keeps Markdown, list numbering and nested folds inside details", () => {
    const html = render("## Answer\n\n<details>\n<summary>Evidence</summary>\n\n**Checked** this.\n\n3. Third\n4. Fourth\n\n<details open>\n<summary>More evidence</summary>\n\n> [!NOTE]\n> Nested note\n\n</details>\n\n</details>\n\nVisible conclusion.");
    expect(html).toContain("<h2");
    expect(html.match(/data-response-details/g)).toHaveLength(2);
    expect(html).toContain('<details open=""');
    expect(html).toContain("<strong>Checked</strong>");
    expect(html).toContain('<ol start="3"');
    expect(html).toContain('data-response-callout="NOTE"');
    expect(html).toContain("Visible conclusion.");
    expect(html).not.toContain("&lt;summary&gt;");
  });

  it("keeps a disclosure collapsed until opened and retains its body", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
      act(() => root.render(createElement(ChatMarkdown, { text: "<details>\n<summary>Why it works</summary>\n\nThe explanation.\n\n</details>" })));
      const details = host.querySelector("details")!;
      expect(details.open).toBe(false);
      expect(details.querySelector("summary")?.textContent).toBe("Why it works");
      act(() => { details.open = true; details.dispatchEvent(new Event("toggle")); });
      expect(details.open).toBe(true);
      expect(details.textContent).toContain("The explanation.");
    } finally { act(() => root.unmount()); }
  });

  it("does not grant HTML attributes, scripts, frames or unclosed folds access to the DOM", () => {
    const html = render('<details onclick="alert(1)">\n<summary>Unsafe</summary>\n\nVisible body.\n\n</details>\n\n<script>alert(1)</script>\n\n<iframe src="https://example.test"></iframe>\n\n<details>\n<summary>Unclosed</summary>\n\nStill visible.');
    expect(html).not.toContain("data-response-details");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("<details onclick");
    expect(html).toContain("Visible body.");
    expect(html).toContain("Still visible.");
  });

  it("keeps unsafe HTML and links inert inside an otherwise valid disclosure", () => {
    const html = render('<details>\n<summary>Untrusted evidence</summary>\n\n<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[Unsafe](javascript:alert%281%29)\n\n</details>');
    expect(html).toContain("data-response-details");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain("Untrusted evidence");
  });

  it("sets callout direction from its content and keeps task lists native", () => {
    const html = render("> [!TIP]\n> مرحباً بك\n\n- [x] Done\n- [ ] Next");
    expect(html).toContain('role="note" dir="rtl"');
    expect(html).toContain("contains-task-list");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('checked=""');
  });
});
