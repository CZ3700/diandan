import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as frames from "../management-decoration/preview-frame";
import { informationCopy } from "./copy";
test("information preview has explicit saved-only copy and no frame for missing or stale saved content", () => {
  expect(frames.InformationPreviewFrame).toBeTypeOf("function");
  const html = renderToStaticMarkup(
    createElement(frames.InformationPreviewFrame, {
      document: null,
      locale: "zh-CN",
      origin: "https://storefront.example.invalid",
      copy: informationCopy("zh-CN"),
    }),
  );
  expect(html).not.toContain("<iframe");
  expect(html).toContain(informationCopy("zh-CN").savedOnly);
});
