import type { SupportedLocale } from "@fan-support/contracts";
import { Icon } from "@fan-support/ui";
import type { StorefrontCopy } from "./copy";
import { giftKindEntryHref } from "./gift-browse-query";
import {
  BROWSABLE_GIFT_KINDS,
  giftKindBody,
  giftKindLabel,
} from "./gift-kind-copy";

/** Four fixed entries under the poster; they need no catalog or commerce read to render. */
export function HomeKinds({
  locale,
  copy,
  contextQuery,
}: Readonly<{
  locale: SupportedLocale;
  copy: StorefrontCopy;
  contextQuery: string;
}>) {
  return (
    <section
      className="storefront-section storefront-kinds"
      aria-labelledby="gift-kinds-title"
    >
      <div className="storefront-section-heading">
        <div>
          <p className="storefront-eyebrow">{copy.giftEyebrow}</p>
          <h2 id="gift-kinds-title">{copy.homeKindsTitle}</h2>
        </div>
      </div>
      <ul className="storefront-kinds__list">
        {BROWSABLE_GIFT_KINDS.map((kind, index) => (
          <li key={kind}>
            <a
              href={giftKindEntryHref(locale, kind, contextQuery)}
              data-gift-kind-entry={kind}
            >
              <span className="storefront-kinds__index" aria-hidden="true">
                0{index + 1}
              </span>
              <h3>{giftKindLabel(copy, kind)}</h3>
              <p>{giftKindBody(copy, kind)}</p>
              <Icon name="arrow-right" decorative />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
