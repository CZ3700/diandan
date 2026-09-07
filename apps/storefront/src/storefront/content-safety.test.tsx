import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
test("renders only the allowed biography vocabulary as elements", async () => {
  const loaded = await import("./content-safety.js").catch(() => undefined);
  expect(loaded).toBeDefined();
  if (!loaded) return;
  const html = renderToStaticMarkup(
    <loaded.ControlledBiography text="<p>A <strong>new</strong> story.</p><ul><li>Music</li></ul>" />,
  );
  expect(html).toContain("<strong>new</strong>");
  expect(html).not.toContain("&lt;p&gt;");
  expect(() =>
    renderToStaticMarkup(
      <loaded.ControlledBiography text='<p onclick="alert(1)">x</p>' />,
    ),
  ).toThrow();
});
test("marks any rendered fallback object as unindexable", async () => {
  const loaded = await import("./content-safety.js").catch(() => undefined);
  expect(loaded).toBeDefined();
  if (!loaded) return;
  expect(
    loaded.hasFallback([
      {
        requestedLocale: "ja",
        resolvedLocale: "ja",
        fallbackUsed: false,
        schemaVersion: 1,
      },
      {
        requestedLocale: "ja",
        resolvedLocale: "en",
        fallbackUsed: true,
        schemaVersion: 1,
      },
    ]),
  ).toBe(true);
});
