import { expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
const subject = await import("./brand-editor").catch(() => undefined);
const copies = await import("./brand-copy").catch(() => undefined);
test.each(SUPPORTED_LOCALES)(
  "%s has two accessible logo inputs without hidden theme or brand-name editing",
  (locale) => {
    expect(subject?.BrandEditor).toBeTypeOf("function");
    expect(copies?.brandCopy).toBeTypeOf("function");
    const Editor = subject!.BrandEditor;
    const html = renderToStaticMarkup(
      <Editor
        view={{ schemaVersion: 1, lightLogo: null, darkLogo: null }}
        disabled
        copy={copies!.brandCopy(locale)}
        onUpload={vi.fn()}
        onRemove={vi.fn()}
        onCancelUpload={vi.fn()}
      />,
    );
    expect(html.match(/type="file"/gu)).toHaveLength(2);
    expect(html).toContain('data-brand-slot="lightLogo"');
    expect(html).toContain('data-brand-slot="darkLogo"');
    expect(html.match(/type="file"[^>]*disabled/gu)).toHaveLength(2);
    expect(html).not.toMatch(/undefined|\[object Object\]|type="text"/u);
  },
);
