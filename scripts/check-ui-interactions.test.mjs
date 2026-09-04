import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

async function loadValidator() {
  let module;
  try {
    module = await import("./check-ui-interactions.mjs");
  } catch {
    module = undefined;
  }

  assert.equal(
    typeof module?.validateUiInteractions,
    "function",
    "P2-03 UI interaction validator must exist",
  );
  return module.validateUiInteractions;
}

const routes = Object.freeze({
  "(japanese)/ja": "ja",
  "(latin)/en": "en",
  "(latin)/en-XA": "en-XA",
  "(latin)/es": "es",
  "(latin)/pt": "pt",
  "(simplified-chinese)/zh-CN": "zh-CN",
  "(thai)/th": "th",
  "(vietnamese)/vi": "vi",
});

async function write(root, relativePath, contents) {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents);
}

async function replace(root, relativePath, from, to) {
  const absolutePath = path.join(root, relativePath);
  const current = await readFile(absolutePath, "utf8");
  assert.ok(current.includes(from), `${relativePath} must contain test target`);
  await writeFile(absolutePath, current.replace(from, to));
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ui-interactions-"));

  await write(
    root,
    "packages/ui/package.json",
    JSON.stringify({
      name: "@fan-support/ui",
      sideEffects: ["./styles/interactions.css", "./styles/primitives.css"],
      exports: {
        ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
        "./client": {
          types: "./dist/client.d.ts",
          import: "./dist/client.js",
        },
        "./interactions": {
          types: "./dist/interactions.d.ts",
          import: "./dist/interactions.js",
        },
        "./interactions.css": "./styles/interactions.css",
        "./primitives.css": "./styles/primitives.css",
      },
      dependencies: {
        "@base-ui/react": "1.7.0",
        "@fan-support/contracts": "workspace:*",
        "class-variance-authority": "0.7.1",
      },
    }),
  );
  await write(
    root,
    "packages/ui/src/interactions.ts",
    `"use client";

export { Dialog, Drawer } from "./overlay.js";
export { LiveRegion } from "./live-region.js";
export { Menu } from "./menu.js";
export { LanguageControl, RegionControl } from "./selection-controls.js";
export { ToastProvider, useToast } from "./toast.js";
export type { DialogProps, DrawerProps, DrawerSide } from "./overlay.js";
export type { LiveRegionProps } from "./live-region.js";
export type { MenuOption, MenuProps } from "./menu.js";
export type { LanguageControlProps, RegionControlProps, RegionOption } from "./selection-controls.js";
export type { ToastController, ToastMessage, ToastProviderProps } from "./toast.js";
`,
  );
  await write(
    root,
    "packages/ui/src/index.ts",
    'export { Button } from "./button.js";\n',
  );
  await write(
    root,
    "packages/ui/src/client.ts",
    '"use client";\nexport { Media, Quantity } from "./media.js";\n',
  );
  await write(
    root,
    "packages/ui/src/overlay.tsx",
    '"use client";\nimport { Dialog as DialogPrimitive } from "@base-ui/react/dialog";\nimport { Icon } from "./icon.js";\nexport function Dialog() { return <Icon decorative name="close" />; }\nexport function Drawer() { return DialogPrimitive; }\n',
  );
  await write(
    root,
    "packages/ui/src/menu.tsx",
    `"use client";
import { Menu as MenuPrimitive, type MenuRootChangeEventDetails } from "@base-ui/react/menu";
import { useEffect, useState } from "react";
import { Icon } from "./icon.js";
const MENU_SCROLL_LOCK_ATTRIBUTE = "data-fs-menu-scroll-lock";
let menuScrollLockCount = 0;
function acquireMenuScrollLock() {
  const root = document.documentElement;
  const preventOutsideTouchScroll = (event: TouchEvent) => {
    const insidePopup = event.composedPath().some(
      (target) => target instanceof Element && target.classList.contains("fs-menu__popup"),
    );
    if (!insidePopup) event.preventDefault();
  };
  menuScrollLockCount += 1;
  root.setAttribute(MENU_SCROLL_LOCK_ATTRIBUTE, "");
  document.addEventListener("touchmove", preventOutsideTouchScroll, { passive: false });
  return () => {
    document.removeEventListener("touchmove", preventOutsideTouchScroll);
    menuScrollLockCount = Math.max(0, menuScrollLockCount - 1);
    if (menuScrollLockCount === 0) root.removeAttribute(MENU_SCROLL_LOCK_ATTRIBUTE);
  };
}
export function Menu() {
  const [open, setOpen] = useState(false);
  const handleOpenChange = (nextOpen: boolean, eventDetails: MenuRootChangeEventDetails) => {
    if (!nextOpen && eventDetails.reason === "outside-press" && eventDetails.event.type === "touchmove") {
      eventDetails.cancel();
      return;
    }
    setOpen(nextOpen);
  };
  useEffect(() => {
    if (!open) return;
    return acquireMenuScrollLock();
  }, [open]);
  return <MenuPrimitive.Root open={open} onOpenChange={handleOpenChange}>
    <Icon decorative name="chevron-down" />
    <MenuPrimitive.RadioItemIndicator keepMounted>
      <Icon decorative name="check" />
    </MenuPrimitive.RadioItemIndicator>
  </MenuPrimitive.Root>;
}
`,
  );
  await write(
    root,
    "packages/ui/src/toast.tsx",
    '"use client";\nimport { Toast as ToastPrimitive } from "@base-ui/react/toast";\nimport { Icon } from "./icon.js";\nexport function ToastProvider() { return <Icon decorative name="close" />; }\nexport function useToast() { return ToastPrimitive; }\n',
  );
  await write(
    root,
    "packages/ui/src/selection-controls.tsx",
    `"use client";
import { LOCALE_NATIVE_NAMES, SUPPORTED_LOCALES, type SupportedLocale } from "@fan-support/contracts";
import { Menu } from "./menu.js";
const LANGUAGE_OPTIONS = Object.freeze(SUPPORTED_LOCALES.map((locale) =>
  Object.freeze({ label: LOCALE_NATIVE_NAMES[locale], value: locale }),
));
export function LanguageControl({ value }: { value: SupportedLocale }) { return <Menu options={LANGUAGE_OPTIONS} value={value} />; }
export function RegionControl({ options, value }: { options: readonly unknown[]; value: string }) { return <Menu options={options} value={value} />; }
`,
  );
  await write(root, "packages/ui/src/live-region.tsx", '"use client";\n');

  await write(
    root,
    "packages/ui/styles/interactions.css",
    `.fs-overlay-trigger,
.fs-menu__trigger,
.fs-overlay__close,
.fs-toast__close {
  min-inline-size: var(--space-12);
  min-block-size: var(--space-12);
  padding-block: var(--space-2);
  padding-inline: var(--space-3);
  transition: transform var(--motion-control-effective) var(--ease-out);
}

.fs-overlay-trigger:focus-visible,
.fs-menu__trigger:focus-visible,
.fs-menu__item:focus-visible,
.fs-overlay__close:focus-visible,
.fs-toast:focus-visible,
.fs-toast__close:focus-visible {
  outline: var(--focus-ring-width) solid var(--color-accent);
  outline-offset: var(--focus-ring-offset);
}

.fs-overlay__title,
.fs-overlay__description,
.fs-menu__label,
.fs-menu__value,
.fs-menu__detail,
.fs-menu__item-label,
.fs-menu__item-detail,
.fs-toast__title,
.fs-toast__description {
  overflow-wrap: anywhere;
}

.fs-overlay__backdrop { inset: 0; }
.fs-menu__popup { max-block-size: var(--available-height); overflow: auto; }
.fs-menu__item[data-highlighted]::before {
  content: "";
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0;
  inline-size: var(--focus-ring-width);
  background: var(--color-accent);
}
.fs-menu__indicator[data-unchecked] { visibility: hidden; }
.fs-toast[data-limited] { display: none; }
.fs-toast__viewport { inset-block-end: var(--space-4); inset-inline-end: var(--space-4); }

:root[data-fs-menu-scroll-lock],
:root[data-fs-menu-scroll-lock] body {
  overflow: hidden;
  overscroll-behavior: none;
}

@media (prefers-reduced-motion: reduce) {
  .fs-overlay-trigger,
  .fs-menu__trigger,
  .fs-menu__popup,
  .fs-overlay__backdrop,
  .fs-dialog__popup,
  .fs-drawer__popup,
  .fs-overlay__close,
  .fs-toast,
  .fs-toast__close { transition: none; }
  .fs-menu__popup[data-starting-style],
  .fs-dialog__popup[data-starting-style],
  .fs-drawer__popup[data-starting-style],
  .fs-toast[data-starting-style] { transform: none; }
  .fs-overlay__viewport .fs-drawer__popup[data-side][data-starting-style],
  .fs-overlay__viewport .fs-drawer__popup[data-side][data-ending-style] { transform: none; }
}
`,
  );

  await write(
    root,
    "packages/contracts/src/locale.ts",
    `export const SUPPORTED_LOCALES = Object.freeze([
  "en", "zh-CN", "th", "vi", "ja", "es", "pt",
] as const);
export const LOCALE_NATIVE_NAMES = Object.freeze({
  en: "English", "zh-CN": "简体中文", th: "ไทย", vi: "Tiếng Việt", ja: "日本語", es: "Español", pt: "Português",
});
export const supportedLocaleSchema = z.enum(SUPPORTED_LOCALES);
`,
  );
  await write(
    root,
    "apps/storefront/src/app/globals.css",
    '@import "@fan-support/ui/interactions.css";\n@import "@fan-support/ui/primitives.css";\n',
  );
  await write(
    root,
    "apps/storefront/src/app/ui-interaction-lab.tsx",
    `"use client";
import { useEffect } from "react";
export function UiInteractionLab({ previewLocale }: { previewLocale: string }) {
  useEffect(() => {
    const root = document.documentElement;
    const previousLanguage = root.lang;
    root.lang = previewLocale;
    return () => {
      root.lang = previousLanguage;
    };
  }, [previewLocale]);
  return null;
}
`,
  );
  await write(
    root,
    "apps/storefront/src/presentation-locale.ts",
    `import { supportedLocaleSchema, type SupportedLocale } from "@fan-support/contracts";
const PRESENTATION_LOCALE_COOKIE_NAME = "site_locale";
const PRESENTATION_LOCALE_MAX_AGE_SECONDS = 31_536_000;
function requireSupportedLocale(value: unknown): SupportedLocale {
  const parsed = supportedLocaleSchema.safeParse(value);
  if (!parsed.success) throw new TypeError("Expected a canonical supported locale");
  return parsed.data;
}
export function createPresentationLocaleUrl(currentUrl: URL, nextLocale: unknown): URL {
  const locale = requireSupportedLocale(nextLocale);
  const source = supportedLocaleSchema.safeParse(currentUrl.pathname.split("/")[1]);
  if (!source.success) throw new TypeError("Expected a route with a canonical leading locale");
  const destination = new URL(currentUrl.href);
  const segments = destination.pathname.split("/");
  segments[1] = locale;
  destination.pathname = segments.join("/");
  return destination;
}
export function serializePresentationLocaleCookie(locale: unknown, options: { secure: boolean }): string {
  const value = requireSupportedLocale(locale);
  const attributes = [
    \`\${PRESENTATION_LOCALE_COOKIE_NAME}=\${value}\`,
    "Path=/",
    \`Max-Age=\${PRESENTATION_LOCALE_MAX_AGE_SECONDS}\`,
    "SameSite=Lax",
  ];
  if (options.secure) attributes.push("Secure");
  return attributes.join("; ");
}
`,
  );
  await write(
    root,
    "apps/storefront/src/internal-presentation-locale.ts",
    `import { supportedLocaleSchema } from "@fan-support/contracts";
export function createInternalPresentationLocaleUrl(currentUrl: URL, nextLocale: unknown): URL {
  const target = supportedLocaleSchema.safeParse(nextLocale);
  if (!target.success) throw new TypeError("Expected a canonical supported locale");
  const sourceLocale = currentUrl.pathname.split("/")[3];
  const sourceIsPreviewLocale = sourceLocale === "en-XA" || supportedLocaleSchema.safeParse(sourceLocale).success;
  if (!sourceIsPreviewLocale) throw new TypeError("Expected a gated interaction preview route");
  const destination = new URL(currentUrl.href);
  const segments = destination.pathname.split("/");
  segments[3] = target.data;
  destination.pathname = segments.join("/");
  return destination;
}
`,
  );

  for (const [route, locale] of Object.entries(routes)) {
    await write(
      root,
      `apps/storefront/src/app/%5Finternal/design-foundations/${route}/interactions/page.tsx`,
      `import { UiInteractionsSpecimen } from "../../../../../ui-interactions-specimen";\nexport default function Page() { return <UiInteractionsSpecimen locale="${locale}" />; }\n`,
    );
  }

  return root;
}

function includesError(errors, expected) {
  assert.ok(
    errors.some((error) => error.includes(expected)),
    `expected error containing ${JSON.stringify(expected)}, received:\n${errors.join("\n")}`,
  );
}

async function validateFixture(context) {
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  return { root, validateUiInteractions: await loadValidator() };
}

test("accepts the reviewed P2-03 interaction contract", async (context) => {
  const { root, validateUiInteractions } = await validateFixture(context);
  assert.deepEqual(await validateUiInteractions(root), []);
});

test("requires exact interaction package exports and Base UI pin", async (context) => {
  const { root, validateUiInteractions } = await validateFixture(context);
  await replace(root, "packages/ui/package.json", "1.7.0", "^1.7.0");
  await replace(
    root,
    "packages/ui/package.json",
    "./dist/interactions.js",
    "./src/interactions.ts",
  );

  const errors = await validateUiInteractions(root);
  includesError(errors, "@base-ui/react must be pinned to 1.7.0");
  includesError(errors, "exact package export ./interactions");
});

test("requires the dedicated client entrypoint and exact value exports", async (context) => {
  const { root, validateUiInteractions } = await validateFixture(context);
  await replace(root, "packages/ui/src/interactions.ts", '"use client";', "");
  await replace(
    root,
    "packages/ui/src/interactions.ts",
    "export { Dialog, Drawer }",
    "export { Dialog, Drawer, ModalSurface }",
  );

  const errors = await validateUiInteractions(root);
  includesError(errors, "interactions entrypoint must begin with use client");
  includesError(errors, "exact interaction value exports");
});

test("keeps interaction values out of the root and legacy client entries", async (context) => {
  const { root, validateUiInteractions } = await validateFixture(context);
  await write(
    root,
    "packages/ui/src/index.ts",
    'export { Button, Dialog } from "./button.js";\n',
  );
  await write(
    root,
    "packages/ui/src/client.ts",
    '"use client";\nexport { Media, ToastProvider } from "./media.js";\n',
  );

  const errors = await validateUiInteractions(root);
  includesError(
    errors,
    "root entrypoint must not export interaction value Dialog",
  );
  includesError(
    errors,
    "legacy client entrypoint must not export interaction value ToastProvider",
  );
});

test("confines Base UI to reviewed UI submodules", async (context) => {
  const { root, validateUiInteractions } = await validateFixture(context);
  await write(
    root,
    "apps/storefront/src/app/bypass.tsx",
    'import { Dialog } from "@base-ui/react/dialog";\n',
  );
  await write(
    root,
    "packages/ui/src/tooltip.tsx",
    'import { Tooltip } from "@base-ui/react/tooltip";\n',
  );

  const errors = await validateUiInteractions(root);
  includesError(errors, "Base UI imports are allowed only in packages/ui");
  includesError(errors, "unreviewed Base UI submodule @base-ui/react/tooltip");
});

test("requires the Storefront interaction stylesheet import", async (context) => {
  const { root, validateUiInteractions } = await validateFixture(context);
  await replace(
    root,
    "apps/storefront/src/app/globals.css",
    '@import "@fan-support/ui/interactions.css";\n',
    "",
  );
  includesError(
    await validateUiInteractions(root),
    "Storefront globals must import @fan-support/ui/interactions.css exactly once",
  );
});

test("requires exactly eight gated interaction routes with matching locales", async (context) => {
  const { root, validateUiInteractions } = await validateFixture(context);
  await rm(
    path.join(
      root,
      "apps/storefront/src/app/%5Finternal/design-foundations/(thai)/th/interactions/page.tsx",
    ),
  );
  await replace(
    root,
    "apps/storefront/src/app/%5Finternal/design-foundations/(latin)/es/interactions/page.tsx",
    'locale="es"',
    'locale="en"',
  );
  await write(
    root,
    "apps/storefront/src/app/fr/interactions/page.tsx",
    'export default function Page() { return <UiInteractionsSpecimen locale="fr" />; }\n',
  );

  const errors = await validateUiInteractions(root);
  includesError(errors, "missing interaction preview route th");
  includesError(errors, 'interaction preview es must render locale="es"');
  includesError(errors, "unexpected interaction page");
});

test("derives language options from canonical locale contracts", async (context) => {
  const { root, validateUiInteractions } = await validateFixture(context);
  await replace(
    root,
    "packages/ui/src/selection-controls.tsx",
    "SUPPORTED_LOCALES.map((locale)",
    '["en", "zh-CN"].map((locale)',
  );
  await replace(
    root,
    "packages/ui/src/selection-controls.tsx",
    "LOCALE_NATIVE_NAMES[locale]",
    "locale",
  );

  const errors = await validateUiInteractions(root);
  includesError(
    errors,
    "LanguageControl options must derive from SUPPORTED_LOCALES",
  );
  includesError(errors, "LanguageControl labels must use LOCALE_NATIVE_NAMES");
});

test("keeps pseudo locale internal and forbids flag-based language UI", async (context) => {
  const { root, validateUiInteractions } = await validateFixture(context);
  await replace(
    root,
    "packages/ui/src/selection-controls.tsx",
    "const LANGUAGE_OPTIONS",
    'const previewLocale = "en-XA";\nconst flag = "🇺🇸";\nconst LANGUAGE_OPTIONS',
  );

  const errors = await validateUiInteractions(root);
  includesError(errors, "en-XA must not enter the public language control");
  includesError(errors, "language and region controls must not use flags");
});

test("requires schema-validated locale URLs and host-only cookie attributes", async (context) => {
  const { root, validateUiInteractions } = await validateFixture(context);
  await replace(
    root,
    "apps/storefront/src/presentation-locale.ts",
    "supportedLocaleSchema.safeParse(value)",
    "{ success: true, data: value as SupportedLocale }",
  );
  await replace(
    root,
    "apps/storefront/src/presentation-locale.ts",
    '"SameSite=Lax",',
    '"SameSite=None", "Domain=.example.com",',
  );
  await replace(
    root,
    "apps/storefront/src/presentation-locale.ts",
    "Max-Age=",
    "Lifetime=",
  );

  const errors = await validateUiInteractions(root);
  includesError(
    errors,
    "presentation locale values must use supportedLocaleSchema.safeParse",
  );
  includesError(errors, "locale cookie must set SameSite=Lax");
  includesError(errors, "locale cookie must remain host-only without Domain");
  includesError(errors, "locale cookie must set Max-Age=31536000");
});

test("allows en-XA only as an internal source and validates public targets", async (context) => {
  const { root, validateUiInteractions } = await validateFixture(context);
  await replace(
    root,
    "apps/storefront/src/internal-presentation-locale.ts",
    'sourceLocale === "en-XA" ||',
    "",
  );
  await replace(
    root,
    "apps/storefront/src/internal-presentation-locale.ts",
    "supportedLocaleSchema.safeParse(nextLocale)",
    "{ success: true, data: nextLocale as string }",
  );

  const errors = await validateUiInteractions(root);
  includesError(
    errors,
    "internal adapter must recognize en-XA only as a source preview locale",
  );
  includesError(
    errors,
    "internal adapter targets must use supportedLocaleSchema.safeParse",
  );
});

test("requires visible focus and reduced-motion coverage", async (context) => {
  const { root, validateUiInteractions } = await validateFixture(context);
  await replace(
    root,
    "packages/ui/styles/interactions.css",
    ":focus-visible",
    ":focus",
  );
  await replace(
    root,
    "packages/ui/styles/interactions.css",
    "@media (prefers-reduced-motion: reduce)",
    "@media (prefers-reduced-motion: no-preference)",
  );

  const errors = await validateUiInteractions(root);
  includesError(
    errors,
    "interaction controls must have visible :focus-visible styles",
  );
  includesError(
    errors,
    "interaction CSS must include a reduced-motion override",
  );
});

test("requires a design-system focus indicator on focused Toast roots", async (context) => {
  const { root, validateUiInteractions } = await validateFixture(context);
  await replace(
    root,
    "packages/ui/styles/interactions.css",
    ".fs-toast:focus-visible,",
    ".fs-toast:focus,",
  );

  const errors = await validateUiInteractions(root);
  includesError(
    errors,
    "interaction controls must have visible :focus-visible styles (.fs-toast)",
  );
});

test("requires a specificity-safe reduced-motion Drawer transform override", async (context) => {
  const { root, validateUiInteractions } = await validateFixture(context);
  await replace(
    root,
    "packages/ui/styles/interactions.css",
    ".fs-overlay__viewport .fs-drawer__popup[data-side][data-starting-style]",
    ".fs-drawer__popup[data-starting-style]",
  );

  const errors = await validateUiInteractions(root);
  includesError(
    errors,
    "reduced-motion Drawer transform override must beat directional selectors",
  );
});

test("forbids physical direction, z-index, and visible critical-copy truncation", async (context) => {
  const { root, validateUiInteractions } = await validateFixture(context);
  await replace(
    root,
    "packages/ui/styles/interactions.css",
    "padding-inline: var(--space-3);",
    "padding-left: var(--space-3);\n  z-index: 9999;",
  );
  await replace(
    root,
    "packages/ui/styles/interactions.css",
    "overflow-wrap: anywhere;",
    "overflow: hidden;\n  white-space: nowrap;\n  text-overflow: ellipsis;",
  );

  const errors = await validateUiInteractions(root);
  includesError(errors, "physical-direction property padding-left");
  includesError(errors, "interaction CSS must not declare z-index");
  includesError(errors, "visible critical copy must not be truncated");
});

test("rejects physical border and directional text alignment", async (context) => {
  const { root, validateUiInteractions } = await validateFixture(context);
  await replace(
    root,
    "packages/ui/styles/interactions.css",
    ".fs-overlay__backdrop { inset: 0; }",
    ".fs-overlay__backdrop { border-left: 1px solid red; text-align: right; }",
  );

  const errors = await validateUiInteractions(root);
  includesError(errors, "physical-direction property border-left");
  includesError(errors, "physical-direction value text-align: right");
});

test("requires the Menu highlight rail on logical inline-start", async (context) => {
  const { root, validateUiInteractions } = await validateFixture(context);
  await replace(
    root,
    "packages/ui/styles/interactions.css",
    "inset-inline-start: 0;",
    "inset-inline-end: 0;",
  );

  const errors = await validateUiInteractions(root);
  includesError(
    errors,
    "Menu highlighted indicator must use logical inline-start",
  );
});

test("requires stable, bounded menu layout and scroll locking", async (context) => {
  const { root, validateUiInteractions } = await validateFixture(context);
  await replace(
    root,
    "packages/ui/src/menu.tsx",
    "open={open} onOpenChange={handleOpenChange}",
    "defaultOpen={open}",
  );
  await replace(
    root,
    "packages/ui/src/menu.tsx",
    "let menuScrollLockCount = 0;",
    "let menuWasLocked = false;",
  );
  await replace(
    root,
    "packages/ui/src/menu.tsx",
    "root.removeAttribute(MENU_SCROLL_LOCK_ATTRIBUTE);",
    "root.toggleAttribute(MENU_SCROLL_LOCK_ATTRIBUTE);",
  );
  await replace(
    root,
    "packages/ui/src/menu.tsx",
    'eventDetails.event.type === "touchmove"',
    'eventDetails.event.type === "touchend"',
  );
  await replace(
    root,
    "packages/ui/src/menu.tsx",
    "event.preventDefault();",
    "event.stopPropagation();",
  );
  await replace(
    root,
    "packages/ui/styles/interactions.css",
    "overflow: hidden;",
    "overflow: auto;",
  );
  await replace(
    root,
    "packages/ui/src/menu.tsx",
    "RadioItemIndicator keepMounted",
    "RadioItemIndicator",
  );
  await replace(
    root,
    "packages/ui/styles/interactions.css",
    ".fs-menu__popup { max-block-size: var(--available-height); overflow: auto; }",
    ".fs-menu__popup { max-block-size: var(--space-24); overflow: visible; }",
  );
  await replace(
    root,
    "packages/ui/styles/interactions.css",
    ".fs-menu__indicator[data-unchecked] { visibility: hidden; }",
    ".fs-menu__indicator[data-unchecked] { visibility: visible; }",
  );

  const errors = await validateUiInteractions(root);
  includesError(
    errors,
    "Menu must use a controlled open state for scroll locking",
  );
  includesError(errors, "Menu scroll lock must use a shared reference count");
  includesError(
    errors,
    "Menu scroll lock must set and remove data-fs-menu-scroll-lock on documentElement",
  );
  includesError(
    errors,
    "Menu must cancel touchmove outside dismissal while scroll lock is active",
  );
  includesError(
    errors,
    "Menu scroll lock must prevent outside touchmove without blocking popup scrolling",
  );
  includesError(
    errors,
    "interaction CSS must lock root and body overflow while a menu is open",
  );
  includesError(
    errors,
    "Menu RadioItemIndicator must keep its layout slot mounted",
  );
  includesError(
    errors,
    "menu popup max-block-size must use --available-height",
  );
  includesError(errors, "menu popup must use overflow: auto");
  includesError(errors, "unchecked Menu indicator must remain visually hidden");
});

test("requires the interaction lab to set and restore the portal language", async (context) => {
  const { root, validateUiInteractions } = await validateFixture(context);
  await replace(
    root,
    "apps/storefront/src/app/ui-interaction-lab.tsx",
    "root.lang = previewLocale;",
    'root.lang = "en";',
  );
  await replace(
    root,
    "apps/storefront/src/app/ui-interaction-lab.tsx",
    "root.lang = previousLanguage;",
    "root.lang = previewLocale;",
  );

  const errors = await validateUiInteractions(root);
  includesError(
    errors,
    "interaction lab must synchronize documentElement lang to previewLocale",
  );
  includesError(
    errors,
    "interaction lab must restore the previous documentElement lang",
  );
});

test("requires source-owned interaction icons and rejects functional glyphs", async (context) => {
  const { root, validateUiInteractions } = await validateFixture(context);
  await replace(
    root,
    "packages/ui/src/overlay.tsx",
    'import { Icon } from "./icon.js";\n',
    "",
  );
  await replace(
    root,
    "packages/ui/src/overlay.tsx",
    'name="close"',
    'name="warning"',
  );
  await replace(
    root,
    "packages/ui/src/menu.tsx",
    'import { Icon } from "./icon.js";\n',
    "",
  );
  await replace(
    root,
    "packages/ui/src/menu.tsx",
    'name="chevron-down"',
    'name="warning"',
  );
  await replace(
    root,
    "packages/ui/src/menu.tsx",
    'name="check"',
    'name="plus"',
  );
  await replace(
    root,
    "packages/ui/src/toast.tsx",
    'import { Icon } from "./icon.js";\n',
    "",
  );
  await replace(
    root,
    "packages/ui/src/toast.tsx",
    'name="close"',
    'name="warning"',
  );
  await replace(
    root,
    "packages/ui/src/overlay.tsx",
    "export function Dialog()",
    'const legacyClose = "×";\nexport function Dialog()',
  );
  await replace(
    root,
    "packages/ui/src/menu.tsx",
    "export function Menu()",
    'const legacyChoices = "▾ ✓";\nexport function Menu()',
  );

  const errors = await validateUiInteractions(root);
  includesError(errors, "overlay must import source-owned Icon from ./icon.js");
  includesError(errors, "menu must import source-owned Icon from ./icon.js");
  includesError(errors, "toast must import source-owned Icon from ./icon.js");
  includesError(errors, 'overlay must render source-owned Icon name="close"');
  includesError(
    errors,
    'menu must render source-owned Icon name="chevron-down"',
  );
  includesError(errors, 'menu must render source-owned Icon name="check"');
  includesError(errors, 'toast must render source-owned Icon name="close"');
  includesError(
    errors,
    "interaction sources must not embed functional glyphs or emoji",
  );
});

test("requires excess toasts to be visually excluded", async (context) => {
  const { root, validateUiInteractions } = await validateFixture(context);
  await replace(
    root,
    "packages/ui/styles/interactions.css",
    ".fs-toast[data-limited] { display: none; }",
    ".fs-toast[data-limited] { opacity: 1; }",
  );

  const errors = await validateUiInteractions(root);
  includesError(errors, "limited Toast items must not remain visible");
});
