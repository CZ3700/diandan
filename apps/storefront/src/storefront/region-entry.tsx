import "server-only";
import { Suspense, type ReactNode } from "react";
import type { SupportedLocale } from "@fan-support/contracts";
import type { StorefrontCopy } from "./copy";
import { storefrontHref } from "./navigation";
import { readSoleCommerceScope } from "./sole-scope-read";

/** ADR-017 addendum: with one published market there is no region to choose. */
export async function RegionChoiceEntry({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (await readSoleCommerceScope()) ? null : children;
}

/** Header and footer entries stream after the shell; nothing shows until the context decides. */
export function regionEntries(
  locale: SupportedLocale,
  copy: StorefrontCopy,
  contextQuery: string,
) {
  const href = storefrontHref(locale, "/region", contextQuery);
  return {
    header: (
      <Suspense fallback={null}>
        <RegionChoiceEntry>
          <p>{copy.regionHint}</p>
          <a href={href}>{copy.region}</a>
        </RegionChoiceEntry>
      </Suspense>
    ),
    footer: (
      <Suspense fallback={null}>
        <RegionChoiceEntry>
          <a href={href}>{copy.region}</a>
        </RegionChoiceEntry>
      </Suspense>
    ),
  };
}
