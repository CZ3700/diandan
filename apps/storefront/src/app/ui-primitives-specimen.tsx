import type { CurrencyCode, MinorAmount } from "@fan-support/contracts";
import type { ReactElement } from "react";

import { Icon, Link, Price, Status } from "@fan-support/ui";

import type { DesignFoundationPreviewLocale } from "../design-foundations";
import { uiPrimitiveCopyForLocale } from "./ui-primitives-copy";
import { UiPrimitiveInteractions } from "./ui-primitives-interactions";
import styles from "./ui-primitives-specimen.module.css";

const SPECIMEN_AMOUNT_MINOR = 2_599 as MinorAmount;
const SPECIMEN_CURRENCY = "USD" as CurrencyCode;

export function UiPrimitivesSpecimen({
  locale,
}: Readonly<{
  locale: DesignFoundationPreviewLocale;
}>): ReactElement {
  const copy = uiPrimitiveCopyForLocale(locale);

  return (
    <main
      className={styles["specimen"]}
      data-font-profile={copy.fontProfile}
      data-theme="editorial-dark"
      data-ui-primitives="v1"
      lang={locale}
    >
      <header className={styles["masthead"]} lang="en">
        <p>Foundation 03 / UI primitives</p>
        <p>{locale}</p>
      </header>

      <section className={styles["intro"]} aria-labelledby="primitive-heading">
        <p className={styles["eyebrow"]} lang="en">
          Internal interaction specimen
        </p>
        <h1 id="primitive-heading">{copy.heading}</h1>
        <p>{copy.intro}</p>
      </section>

      <section className={styles["panel"]} aria-labelledby="meaning-heading">
        <h2 id="meaning-heading" lang="en">
          Navigation, price and status
        </h2>
        <div className={styles["meaningGrid"]}>
          <Link href="#primitive-form" variant="standalone">
            {copy.controls.link}
          </Link>
          <span className={styles["iconProof"]}>
            <Icon decorative name="shopping-bag" />
            {copy.controls.iconLabel}
          </span>
          <Price
            amountMinor={SPECIMEN_AMOUNT_MINOR}
            currency={SPECIMEN_CURRENCY}
            locale={copy.presentationLocale}
          />
          <Status tone="success">{copy.controls.status}</Status>
        </div>
      </section>

      <UiPrimitiveInteractions copy={copy.controls} />

      <footer className={styles["footer"]} lang="en">
        <p>Internal specimen — not customer content</p>
        <Link href="/healthz" variant="muted">
          Runtime health
        </Link>
      </footer>
    </main>
  );
}
