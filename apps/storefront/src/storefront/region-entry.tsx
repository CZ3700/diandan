import "server-only";
import { Suspense, type ReactNode } from "react";
import type { SupportedLocale } from "@fan-support/contracts";
import type { StorefrontCopy } from "./copy";
import { navigationTargetHref } from "./navigation-target";
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
  const href = navigationTargetHref(locale, "REGION", contextQuery);
  // Both entries are lazy RSC elements rendered beside a client component's own children,
  // and a single market returns an array of the choice's children: everything is keyed so
  // React never reports a list without keys (the phone menu's "1 Issue").
  return {
    header: (
      <Suspense key="region-entry" fallback={null}>
        <RegionChoiceEntry>
          <p key="hint">{copy.regionHint}</p>
          <a key="choice" href={href}>
            {copy.region}
          </a>
        </RegionChoiceEntry>
      </Suspense>
    ),
    footer: (
      <Suspense key="region-entry" fallback={null}>
        <RegionChoiceEntry>
          <a href={href}>{copy.region}</a>
        </RegionChoiceEntry>
      </Suspense>
    ),
  };
}
