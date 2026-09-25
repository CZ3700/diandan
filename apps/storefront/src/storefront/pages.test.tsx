import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { loadStorefrontCopy } from "@fan-support/i18n/storefront";
test("homepage unavailable state gives recovery without invented featured identities or prices", async () => {
  const loaded = await import("./home-content.js").catch(() => undefined);
  expect(loaded).toBeDefined();
  if (!loaded) return;
  const html = renderToStaticMarkup(
    <loaded.HomeContent
      locale="en"
      copy={await loadStorefrontCopy("en")}
      data={{
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "CONTENT_UNAVAILABLE",
      }}
      contextQuery="currency=USD"
    />,
  );
  expect(html).toContain("temporarily unavailable");
  expect(html).toContain("currency=USD");
  expect(html).not.toContain("Kai Ren");
  expect(html).not.toContain("$0");
});
