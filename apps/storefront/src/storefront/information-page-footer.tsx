import "server-only";
import type { SupportedLocale } from "@fan-support/contracts";
import { readPublicInformationPageIndex } from "../server/public-information-pages";
import { informationPagePath } from "./information-page-path";
import { publicNavigationQuery } from "./navigation-target";
import "./information-page.css";

export async function InformationPageFooter({
  locale,
  contextQuery = "",
}: {
  locale: SupportedLocale;
  contextQuery?: string;
}) {
  const result = await readPublicInformationPageIndex(locale);
  if (result.outcome !== "SUCCESS" || result.entries.length === 0) return null;
  const query = publicNavigationQuery(contextQuery);
  return (
    <ul className="information-page-footer-links">
      {result.entries.map((entry) => (
        <li key={entry.pageKey}>
          <a
            href={`${informationPagePath(locale, entry.pageKey)}${query ? `?${query}` : ""}`}
          >
            {entry.title}
          </a>
        </li>
      ))}
    </ul>
  );
}
