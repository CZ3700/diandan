import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SUPPORTED_LOCALES,
  createDefaultHomeLayout,
  createDefaultStorefrontTheme,
} from "@fan-support/contracts";
import { LayoutPreviewFrame, ThemePreviewFrame } from "./preview-frame";
import { themeCopy } from "./theme-copy";

test.each(SUPPORTED_LOCALES)(
  "%s theme preview exposes replay without enabling the layout preview",
  (locale) => {
    const copy = themeCopy(locale);
    expect(copy.replayPreview).toBeTypeOf("string");
    expect(copy.replayPreview.trim()).not.toBe("");
    const props = {
      locale,
      copy,
      origin: "https://storefront.example.invalid",
    };
    const theme = renderToStaticMarkup(
      <ThemePreviewFrame
        {...props}
        theme={createDefaultStorefrontTheme()}
        replayLabel={copy.replayPreview}
      />,
    );
    const layout = renderToStaticMarkup(
      <LayoutPreviewFrame {...props} layout={createDefaultHomeLayout()} />,
    );
    expect(theme).toContain("data-theme-preview-replay");
    expect(theme).toContain(copy.replayPreview);
    expect(layout).not.toContain("data-theme-preview-replay");
  },
);
