import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { validateDesignFoundations } from "./check-design-foundations.mjs";

const fontPackages = [
  "@fontsource-variable/manrope",
  "@fontsource-variable/noto-sans",
  "@fontsource-variable/noto-sans-jp",
  "@fontsource-variable/noto-sans-sc",
  "@fontsource-variable/noto-sans-thai",
];

const fontProfiles = {
  "japanese.css": ["@fontsource-variable/noto-sans-jp/wght.css"],
  "latin.css": [
    "@fontsource-variable/manrope/wght.css",
    "@fontsource-variable/noto-sans/wght.css",
  ],
  "simplified-chinese.css": ["@fontsource-variable/noto-sans-sc/wght.css"],
  "thai.css": ["@fontsource-variable/noto-sans-thai/wght.css"],
  "vietnamese.css": [
    "@fontsource-variable/manrope/wght.css",
    "@fontsource-variable/noto-sans/wght.css",
  ],
};

const fontHomepages = {
  "@fontsource-variable/manrope": "https://fontsource.org/fonts/manrope",
  "@fontsource-variable/noto-sans": "https://fontsource.org/fonts/noto-sans",
  "@fontsource-variable/noto-sans-jp":
    "https://fontsource.org/fonts/noto-sans-jp",
  "@fontsource-variable/noto-sans-sc":
    "https://fontsource.org/fonts/noto-sans-sc",
  "@fontsource-variable/noto-sans-thai":
    "https://fontsource.org/fonts/noto-sans-thai",
};

const fontCopyrights = {
  "@fontsource-variable/manrope":
    "Copyright 2019 The Manrope Project Authors (https://github.com/sharanda/manrope)",
  "@fontsource-variable/noto-sans":
    "Copyright 2022 The Noto Project Authors (https://github.com/notofonts/latin-greek-cyrillic) NotoSans-Italic[wdth,wght].ttf: Copyright 2022 The Noto Project Authors (https://github.com/notofonts/latin-greek-cyrillic)",
  "@fontsource-variable/noto-sans-jp": "Google Inc.",
  "@fontsource-variable/noto-sans-sc": "Google Inc.",
  "@fontsource-variable/noto-sans-thai":
    "Copyright 2022 The Noto Project Authors (https://github.com/notofonts/thai)",
};

const fixtureLicenseBody = `SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007

PERMISSION & CONDITIONS
Each redistributed copy contains the copyright notice and this license.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS".\n`;

async function write(root, relativePath, contents) {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents);
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "design-foundations-"));
  const dependencies = Object.fromEntries(
    fontPackages.map((packageName) => [packageName, "5.3.0"]),
  );

  await write(
    root,
    "packages/contracts/src/locale.ts",
    `export const SUPPORTED_LOCALES = Object.freeze([
  "en",
  "zh-CN",
  "th",
  "vi",
  "ja",
  "es",
  "pt",
] as const);\n`,
  );

  await write(
    root,
    "packages/design-tokens/package.json",
    JSON.stringify({
      name: "@fan-support/design-tokens",
      dependencies,
      exports: {
        "./foundations.css": "./styles/foundations.css",
        ...Object.fromEntries(
          Object.keys(fontProfiles).map((fileName) => [
            `./fonts/${fileName}`,
            `./styles/fonts/${fileName}`,
          ]),
        ),
      },
    }),
  );
  await write(
    root,
    "packages/design-tokens/src/tokens.ts",
    `export const DESIGN_TOKEN_CONTRACT = Object.freeze({
      schemaVersion: 1,
      breakpoints: Object.freeze({ desktop: "64rem", tablet: "48rem" }),
      runtimeDefaults: Object.freeze({
        "--motion-fast-effective": "var(--motion-fast)",
      }),
      values: Object.freeze({
        "--color-bg": "#0a0a0c",
        "--motion-fast": "120ms",
        "--motion-reduced": "0ms",
        "--space-1": "0.25rem",
      }),
    } as const);\n`,
  );
  await write(
    root,
    "packages/design-tokens/styles/foundations.css",
    `:root,
    [data-theme="editorial-dark"] {
      --color-bg: #0a0a0c;
      --motion-fast: 120ms;
      --motion-reduced: 0ms;
      --space-1: 0.25rem;
      --motion-fast-effective: var(--motion-fast);
    }
    @media (min-width: 48rem) {}
    @media (min-width: 64rem) {}
    @media (prefers-reduced-motion: reduce) {
      :root { --motion-fast-effective: var(--motion-reduced); }
    }\n`,
  );

  for (const [fileName, imports] of Object.entries(fontProfiles)) {
    await write(
      root,
      `packages/design-tokens/styles/fonts/${fileName}`,
      `${imports.map((fontImport) => `@import "${fontImport}";`).join("\n")}\n`,
    );
  }
  await write(
    root,
    "packages/design-tokens/src/font-profiles.ts",
    `import { SUPPORTED_LOCALES } from "@fan-support/contracts";

const latinProfile = Object.freeze({ cssModule: "@fan-support/design-tokens/fonts/latin.css", id: "latin" });
const vietnameseProfile = Object.freeze({ cssModule: "@fan-support/design-tokens/fonts/vietnamese.css", id: "vietnamese" });
const simplifiedChineseProfile = Object.freeze({ cssModule: "@fan-support/design-tokens/fonts/simplified-chinese.css", id: "simplified-chinese" });
const japaneseProfile = Object.freeze({ cssModule: "@fan-support/design-tokens/fonts/japanese.css", id: "japanese" });
const thaiProfile = Object.freeze({ cssModule: "@fan-support/design-tokens/fonts/thai.css", id: "thai" });

function fontProfileForLocale(locale) {
  switch (locale) {
    case "en":
    case "es":
    case "pt":
      return latinProfile;
    case "ja":
      return japaneseProfile;
    case "th":
      return thaiProfile;
    case "vi":
      return vietnameseProfile;
    case "zh-CN":
      return simplifiedChineseProfile;
    default: {
      const exhaustiveLocale: never = locale;
      return exhaustiveLocale;
    }
  }
}

export const FONT_PROFILE_BY_LOCALE = Object.freeze(
  Object.fromEntries(
    SUPPORTED_LOCALES.map(
      (locale) => [locale, fontProfileForLocale(locale)] as const,
    ),
  ),
);\n`,
  );

  const localeProfiles = {
    en: "latin",
    es: "latin",
    ja: "japanese",
    pt: "latin",
    th: "thai",
    vi: "vietnamese",
    "zh-CN": "simplified-chinese",
    "en-XA": "latin",
  };
  for (const [locale, profile] of Object.entries(localeProfiles)) {
    await write(
      root,
      `apps/storefront/src/app/%5Finternal/design-foundations/(${profile})/${locale}/page.tsx`,
      `export default function Page() { return <DesignFoundationSpecimen locale="${locale}" />; }\n`,
    );
  }
  for (const fileName of Object.keys(fontProfiles)) {
    const profile = fileName.replace(/\.css$/u, "");
    await write(
      root,
      `apps/storefront/src/app/%5Finternal/design-foundations/(${profile})/layout.tsx`,
      `import "@fan-support/design-tokens/fonts/${fileName}";\n`,
    );
  }

  const notice = ["# Font third-party notices", ""];
  for (const packageName of fontPackages) {
    const packageDirectory = path.join(
      "packages/design-tokens/node_modules",
      packageName,
    );
    await write(
      root,
      path.join(packageDirectory, "package.json"),
      JSON.stringify({
        name: packageName,
        version: "5.3.0",
        license: "OFL-1.1",
        homepage: fontHomepages[packageName],
      }),
    );
    await write(
      root,
      path.join(packageDirectory, "LICENSE"),
      `${fontCopyrights[packageName]}\n\n${fixtureLicenseBody}`,
    );
    await write(
      root,
      path.join(packageDirectory, "wght.css"),
      '@font-face { src: url("./files/font.woff2") format("woff2"); }\n',
    );
    notice.push(
      `- ${packageName} | 5.3.0 | OFL-1.1 | ${fontHomepages[packageName]}`,
    );
  }
  notice.push(
    "",
    ...new Set(Object.values(fontCopyrights)),
    "",
    fixtureLicenseBody,
  );
  await write(
    root,
    "packages/design-tokens/THIRD_PARTY_NOTICES.md",
    `${notice.join("\n")}\n`,
  );
  await write(
    root,
    "infra/docker/Dockerfile",
    `FROM scratch AS storefront
COPY --from=builder /workspace/packages/design-tokens/THIRD_PARTY_NOTICES.md /app/THIRD_PARTY_NOTICES.md
FROM scratch AS admin
COPY --from=builder /workspace/packages/design-tokens/THIRD_PARTY_NOTICES.md /app/THIRD_PARTY_NOTICES.md
`,
  );

  for (const appName of ["admin", "storefront"]) {
    await write(
      root,
      `apps/${appName}/package.json`,
      JSON.stringify({
        dependencies: { "@fan-support/design-tokens": "workspace:*" },
      }),
    );
    await write(
      root,
      `apps/${appName}/src/app/globals.css`,
      `@import "@fan-support/design-tokens/foundations.css";
      .shell {
        min-height: 100svh;
        width: 100%;
        margin: 0;
        padding: var(--space-1);
        color: var(--color-bg);
        transition-duration: var(--motion-fast-effective);
      }\n`,
    );
  }
  await write(
    root,
    "apps/storefront/src/app/icon.svg",
    '<svg xmlns="http://www.w3.org/2000/svg"><path fill="#ffffff" /></svg>\n',
  );
  await write(root, "packages/ui/src/index.ts", "export {};\n");

  return root;
}

test("accepts synchronized tokens, licensed local fonts, package CSS imports, and tokenized consumer CSS", async (context) => {
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));

  assert.deepEqual(await validateDesignFoundations(root), []);
});

test("rejects a token value that drifted from the CSS contract", async (context) => {
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  await write(
    root,
    "packages/design-tokens/styles/foundations.css",
    `:root { --color-bg: #0a0a0c; --motion-fast: 120ms; --space-1: 0.5rem; }
    @media (min-width: 48rem) {}
    @media (min-width: 64rem) {}\n`,
  );

  const errors = await validateDesignFoundations(root);
  assert.ok(
    errors.some(
      (error) =>
        error.includes("--space-1") &&
        error.includes("expected 0.25rem") &&
        error.includes("found 0.5rem"),
    ),
  );
});

test("rejects undeclared foundation tokens and breakpoint drift", async (context) => {
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  await write(
    root,
    "packages/design-tokens/styles/foundations.css",
    `:root {
      --color-bg: #0a0a0c;
      --motion-fast: 120ms;
      --space-1: 0.25rem;
      --rogue-space: 2rem;
    }
    @media (min-width: 47rem) {}
    @media (min-width: 64rem) {}\n`,
  );

  const errors = await validateDesignFoundations(root);
  assert.ok(
    errors.some(
      (error) => error.includes("--rogue-space") && error.includes("contract"),
    ),
  );
  assert.ok(
    errors.some((error) => error.includes("tablet") && error.includes("48rem")),
  );
});

test("rejects font version, license, remote URL, and profile-boundary violations", async (context) => {
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  const manifestPath = "packages/design-tokens/package.json";
  const manifest = JSON.parse(
    await readFile(path.join(root, manifestPath), "utf8"),
  );
  manifest.dependencies["@fontsource-variable/manrope"] = "^5.3.0";
  await write(root, manifestPath, JSON.stringify(manifest));
  await write(
    root,
    "packages/design-tokens/node_modules/@fontsource-variable/noto-sans/LICENSE",
    "MIT License\n",
  );
  await write(
    root,
    "packages/design-tokens/node_modules/@fontsource-variable/noto-sans-jp/wght.css",
    '@font-face { src: url("https://fonts.example.invalid/font.woff2"); }\n',
  );
  await write(
    root,
    "packages/design-tokens/styles/fonts/thai.css",
    `@import url("https://fonts.example.invalid/thai.css");
    @import "@fontsource-variable/noto-sans-jp/wght.css";\n`,
  );

  const errors = await validateDesignFoundations(root);
  assert.ok(
    errors.some(
      (error) =>
        error.includes("@fontsource-variable/manrope") &&
        error.includes("5.3.0"),
    ),
  );
  assert.ok(
    errors.some(
      (error) => error.includes("noto-sans/LICENSE") && error.includes("OFL"),
    ),
  );
  assert.ok(
    errors.some(
      (error) => error.includes("thai.css") && error.includes("remote URL"),
    ),
  );
  assert.ok(
    errors.some(
      (error) =>
        error.includes("noto-sans-jp/wght.css") && error.includes("remote URL"),
    ),
  );
  assert.ok(
    errors.some(
      (error) =>
        error.includes("thai.css") && error.includes("profile imports"),
    ),
  );
});

test("rejects a route group that loads the wrong locale font profile", async (context) => {
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  await write(
    root,
    "apps/storefront/src/app/%5Finternal/design-foundations/(japanese)/layout.tsx",
    'import "@fan-support/design-tokens/fonts/thai.css";\n',
  );

  const errors = await validateDesignFoundations(root);
  assert.ok(
    errors.some(
      (error) =>
        error.includes("(japanese)/layout.tsx") &&
        error.includes("fonts/japanese.css"),
    ),
  );
});

test("rejects a canonical font resolver that omits a supported locale", async (context) => {
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  const profilePath = "packages/design-tokens/src/font-profiles.ts";
  const source = await readFile(path.join(root, profilePath), "utf8");
  await write(
    root,
    profilePath,
    source.replace('    case "vi":\n      return vietnameseProfile;\n', ""),
  );

  const errors = await validateDesignFoundations(root);
  assert.ok(
    errors.some((error) =>
      error.includes("font profile resolver is missing canonical locale vi"),
    ),
  );
});

test("rejects a canonical locale mapped to the wrong route profile", async (context) => {
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  const profilePath = "packages/design-tokens/src/font-profiles.ts";
  const source = await readFile(path.join(root, profilePath), "utf8");
  await write(
    root,
    profilePath,
    source.replace(
      '    case "vi":\n      return vietnameseProfile;\n',
      '    case "vi":\n      return thaiProfile;\n',
    ),
  );

  const errors = await validateDesignFoundations(root);
  assert.ok(errors.some((error) => error.includes("(thai)/vi/page.tsx")));
});

test("rejects a default font fallback instead of an exhaustive never guard", async (context) => {
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  const profilePath = "packages/design-tokens/src/font-profiles.ts";
  const source = await readFile(path.join(root, profilePath), "utf8");
  await write(
    root,
    profilePath,
    source.replace(
      `    default: {
      const exhaustiveLocale: never = locale;
      return exhaustiveLocale;
    }`,
      `    default:
      return latinProfile;`,
    ),
  );

  const errors = await validateDesignFoundations(root);
  assert.ok(
    errors.some((error) =>
      error.includes("never guard instead of a default font fallback"),
    ),
  );
});

test("requires SUPPORTED_LOCALES to be a runtime contract import", async (context) => {
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  const profilePath = "packages/design-tokens/src/font-profiles.ts";
  const source = await readFile(path.join(root, profilePath), "utf8");
  await write(
    root,
    profilePath,
    source.replace(
      'import { SUPPORTED_LOCALES } from "@fan-support/contracts";',
      'import type { SUPPORTED_LOCALES } from "@fan-support/contracts";',
    ),
  );

  const errors = await validateDesignFoundations(root);
  assert.ok(
    errors.some((error) =>
      error.includes("must value-import SUPPORTED_LOCALES"),
    ),
  );
});

test("requires the derived locale profile map to remain frozen", async (context) => {
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  const profilePath = "packages/design-tokens/src/font-profiles.ts";
  const source = await readFile(path.join(root, profilePath), "utf8");
  await write(
    root,
    profilePath,
    source.replace(
      "export const FONT_PROFILE_BY_LOCALE = Object.freeze(",
      "export const FONT_PROFILE_BY_LOCALE = (",
    ),
  );

  const errors = await validateDesignFoundations(root);
  assert.ok(
    errors.some((error) =>
      error.includes("FONT_PROFILE_BY_LOCALE must freeze its derived map"),
    ),
  );
});

test("ignores nested decoys when reading the exported locale profile map", async (context) => {
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  const profilePath = "packages/design-tokens/src/font-profiles.ts";
  const source = await readFile(path.join(root, profilePath), "utf8");
  await write(
    root,
    profilePath,
    `${source}\nfunction decoy() {
  const FONT_PROFILE_BY_LOCALE = Object.freeze({ fake: latinProfile });
  return FONT_PROFILE_BY_LOCALE;
}\n`,
  );

  assert.deepEqual(await validateDesignFoundations(root), []);
});

test("rejects locale font imports outside their route-group layout", async (context) => {
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  await write(
    root,
    "apps/storefront/src/app/globals.css",
    `@import "@fan-support/design-tokens/foundations.css";
@import "@fan-support/design-tokens/fonts/japanese.css";
.shell { padding: var(--space-1); }\n`,
  );

  const errors = await validateDesignFoundations(root);
  assert.ok(
    errors.some(
      (error) =>
        error.includes("apps/storefront/src/app/globals.css") &&
        error.includes("route-group layout"),
    ),
  );
});

test("rejects scattered consumer colors, design dimensions, and durations", async (context) => {
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  await write(
    root,
    "packages/ui/src/bad.css",
    `.bad {
      color: #fff;
      background: linear-gradient(red, blue);
      outline: medium solid rebeccapurple;
      padding: 1rem;
      transition-duration: 120ms;
    }\n`,
  );

  const errors = await validateDesignFoundations(root);
  assert.ok(
    errors.some(
      (error) =>
        error.includes("packages/ui/src/bad.css") && error.includes("#fff"),
    ),
  );
  assert.ok(
    errors.some(
      (error) =>
        error.includes("packages/ui/src/bad.css") && error.includes("1rem"),
    ),
  );
  assert.ok(
    errors.some(
      (error) =>
        error.includes("packages/ui/src/bad.css") && error.includes("120ms"),
    ),
  );
  assert.ok(
    errors.some(
      (error) =>
        error.includes("packages/ui/src/bad.css") && error.includes("red"),
    ),
  );
  assert.ok(
    errors.some(
      (error) =>
        error.includes("packages/ui/src/bad.css") &&
        error.includes("rebeccapurple"),
    ),
  );
});

test("does not confuse style keywords or token names with named colors", async (context) => {
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  await write(
    root,
    "packages/ui/src/safe.css",
    `.safe {
      border-style: solid;
      color: var(--color-red-500);
      outline-style: dotted;
    }\n`,
  );

  assert.deepEqual(await validateDesignFoundations(root), []);
});

test("rejects named colors in background image gradients", async (context) => {
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  await write(
    root,
    "packages/ui/src/bad.css",
    ".bad { background-image: linear-gradient(red, blue); }\n",
  );

  const errors = await validateDesignFoundations(root);
  assert.ok(
    errors.some(
      (error) =>
        error.includes("packages/ui/src/bad.css") && error.includes("red"),
    ),
  );
});

test("rejects inline styles and Tailwind arbitrary design literals", async (context) => {
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  await write(
    root,
    "packages/ui/src/bad.tsx",
    `export const variants = "m-[2rem]";
    export const Bad = () => (
      <div
        className="bg-[red] p-[16px] text-[#fff] duration-[120ms]"
        style={{
          backgroundColor: "rebeccapurple",
          opacity: 0.5,
          padding: 16,
          margin: "1rem",
        }}
      />
    );\n`,
  );

  const errors = await validateDesignFoundations(root);
  for (const literal of [
    "2rem",
    "16px",
    "#fff",
    "120ms",
    "rebeccapurple",
    "1rem",
  ]) {
    assert.ok(
      errors.some(
        (error) =>
          error.includes("packages/ui/src/bad.tsx") && error.includes(literal),
      ),
      `expected an inline-source error for ${literal}`,
    );
  }
  assert.ok(
    errors.some(
      (error) =>
        error.includes("packages/ui/src/bad.tsx") &&
        error.includes("inline numeric style padding") &&
        error.includes("16"),
    ),
  );
  assert.ok(
    errors.some(
      (error) =>
        error.includes("packages/ui/src/bad.tsx") &&
        error.includes("instead of red"),
    ),
  );
});

test("rejects consumer media-query breakpoint drift", async (context) => {
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  await write(
    root,
    "packages/ui/src/bad.css",
    `@media (width >= 47rem) {
      .bad { padding: var(--space-1); }
    }\n`,
  );

  const errors = await validateDesignFoundations(root);
  assert.ok(
    errors.some(
      (error) =>
        error.includes("packages/ui/src/bad.css") &&
        error.includes("47rem") &&
        error.includes("breakpoint"),
    ),
  );
});

test("rejects undeclared runtime tokens and fail-open reduced motion", async (context) => {
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  const foundationPath = "packages/design-tokens/styles/foundations.css";
  const css = await readFile(path.join(root, foundationPath), "utf8");
  await write(
    root,
    foundationPath,
    css
      .replace(
        "--motion-fast-effective: var(--motion-fast);",
        "--motion-fast-effective: var(--motion-fast); --idol-on-accent: #fff;",
      )
      .replace(
        "--motion-fast-effective: var(--motion-reduced);",
        "--motion-fast-effective: var(--motion-fast);",
      ),
  );

  const errors = await validateDesignFoundations(root);
  assert.ok(
    errors.some(
      (error) =>
        error.includes("--idol-on-accent") && error.includes("contract"),
    ),
  );
  assert.ok(errors.some((error) => error.includes("reduced-motion")));
});

test("rejects consumer motion that bypasses reduced-motion effective tokens", async (context) => {
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  await write(
    root,
    "packages/ui/src/bad.css",
    `.bad {
      animation-delay: var(--motion-layout);
      transition-duration: var(--motion-fast);
    }\n`,
  );
  await write(
    root,
    "packages/ui/src/bad.tsx",
    `export const Bad = () => (
      <div
        className="duration-[var(--motion-control)]"
        style={{ animationDuration: "var(--motion-hero)" }}
      />
    );\n`,
  );

  const errors = await validateDesignFoundations(root);
  for (const token of [
    "--motion-fast",
    "--motion-control",
    "--motion-hero",
    "--motion-layout",
  ]) {
    assert.ok(
      errors.some(
        (error) =>
          error.includes(token) && error.includes("effective motion token"),
      ),
      `expected a reduced-motion bypass error for ${token}`,
    );
  }
});

test("requires both apps to consume the exported foundations stylesheet", async (context) => {
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  await write(
    root,
    "apps/admin/src/app/globals.css",
    '@import "../../../packages/design-tokens/styles/foundations.css";\n',
  );

  const errors = await validateDesignFoundations(root);
  assert.ok(
    errors.some(
      (error) =>
        error.includes("apps/admin") && error.includes("package export"),
    ),
  );
});

test("requires complete font notices in both distributable web images", async (context) => {
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  await write(
    root,
    "packages/design-tokens/THIRD_PARTY_NOTICES.md",
    "# Incomplete font notice\n",
  );
  await write(
    root,
    "infra/docker/Dockerfile",
    "FROM scratch AS storefront\nFROM scratch AS admin\n",
  );

  const errors = await validateDesignFoundations(root);
  assert.ok(errors.some((error) => error.includes("copyright notice")));
  assert.ok(
    errors.some(
      (error) =>
        error.includes("storefront") && error.includes("THIRD_PARTY_NOTICES"),
    ),
  );
  assert.ok(
    errors.some(
      (error) =>
        error.includes("admin") && error.includes("THIRD_PARTY_NOTICES"),
    ),
  );
});
