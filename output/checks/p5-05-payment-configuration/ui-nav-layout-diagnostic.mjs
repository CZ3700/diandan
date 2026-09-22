import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const base = process.cwd();
const output = path.join(base, "output/checks/p5-05-payment-configuration");
const chunks = path.join(base, "apps/admin/.next/dev/static/chunks");
const fonts = await readFile(
  path.join(chunks, "packages_design-tokens_styles_fonts_latin_1nc-b3s.css"),
  "utf8",
);
let inlineFonts = fonts;
for (const [match, relative] of fonts.matchAll(/url\("([^"]+)"\)/gu)) {
  const bytes = await readFile(path.resolve(chunks, relative));
  inlineFonts = inlineFonts.replace(
    match,
    `url("data:font/woff2;base64,${bytes.toString("base64")}")`,
  );
}
const css = await readFile(
  path.join(chunks, "apps_admin_src_app_globals_03pzd7e.css"),
  "utf8",
);
const center = await readFile(
  path.join(base, "apps/admin/src/management-center/management-center.css"),
  "utf8",
);
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.setContent(
    `<!doctype html><html lang="es" data-font-profile="latin"><head><title>Navigation layout diagnostic</title><style>${inlineFonts}\n${css}\n${center}</style></head><body><div class="mc-shell"><aside class="mc-sidebar"><strong class="mc-brand">Centro de gestión</strong><nav aria-label="Centro de gestión"><button>Artistas</button><button>Regalos</button><button>Imagen de inicio</button><button>Pedidos</button><button data-management-section="PAYMENTS" aria-current="page">Configuración de pagos</button></nav></aside><main class="mc-main"><h1>Configuración de pagos</h1></main></div></body></html>`,
  );
  await page.evaluate(() => globalThis.document.fonts.ready);
  const results = [];
  // Preserve the exact pre-fix mobile declaration for repeatable comparison.
  const originalColumns = await page.addStyleTag({
    content:
      "@media(max-width:48rem){.mc-sidebar nav{grid-template-columns:repeat(3,minmax(0,1fr));}}",
  });
  for (const phase of ["before", "candidate"]) {
    if (phase === "candidate")
      await originalColumns.evaluate((style) => style.remove());
    const geometry = await page
      .locator('[data-management-section="PAYMENTS"]')
      .evaluate((button) => {
        const rect = button.getBoundingClientRect();
        const range = globalThis.document.createRange();
        range.selectNodeContents(button);
        return {
          button: { left: rect.left, right: rect.right, width: rect.width },
          text: [...range.getClientRects()].map((r) => ({
            left: r.left,
            right: r.right,
            width: r.width,
          })),
          font: globalThis.getComputedStyle(button).fontFamily,
        };
      });
    const axe = await new AxeBuilder({ page })
      .withRules(["color-contrast"])
      .analyze();
    results.push({
      phase,
      geometry,
      violations: axe.violations,
      incomplete: axe.incomplete,
    });
    await page.screenshot({
      path: path.join(output, `ui-nav-layout-${phase}.png`),
    });
  }
  await writeFile(
    path.join(output, "ui-nav-layout-diagnostic.json"),
    JSON.stringify(results, null, 2),
  );
  process.stdout.write(
    JSON.stringify(
      results.map(({ phase, geometry, violations, incomplete }) => ({
        phase,
        geometry,
        violations: violations.length,
        incomplete: incomplete.length,
      })),
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
