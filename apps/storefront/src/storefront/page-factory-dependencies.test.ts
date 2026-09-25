import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { FONT_PROFILE_BY_LOCALE } from "@fan-support/design-tokens";

const root = fileURLToPath(new URL("../", import.meta.url));

function staticDependencies(entry: string, found = new Set<string>()) {
  if (found.has(entry)) return found;
  found.add(entry);
  const source = readFileSync(entry, "utf8");
  const imports = source.matchAll(
    /\b(?:from\s+|import\s*)["'](\.[^"']+)["']/gu,
  );
  for (const match of imports) {
    const base = path.resolve(path.dirname(entry), match[1]!);
    const candidate = [base, `${base}.ts`, `${base}.tsx`].find(
      (file) => /\.tsx?$/u.test(file) && existsSync(file),
    );
    if (candidate) staticDependencies(candidate, found);
  }
  return found;
}

test.each(SUPPORTED_LOCALES)(
  "%s homepage does not statically import gift selection client components",
  (locale) => {
    const profile = FONT_PROFILE_BY_LOCALE[locale].id;
    const entry = path.join(
      root,
      `app/(public)/(${profile})/${locale}/page.tsx`,
    );
    const dependencies = [...staticDependencies(entry)].map((file) =>
      path.basename(file),
    );
    expect(
      dependencies.filter((file) =>
        [
          "gift-filters.tsx",
          "gift-recipient.tsx",
          "gift-purchase.tsx",
        ].includes(file),
      ),
    ).toEqual([]);
    expect(dependencies).toContain("home-content.tsx");
  },
);
