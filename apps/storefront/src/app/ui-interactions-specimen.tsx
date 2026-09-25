import type { SupportedLocale } from "@fan-support/contracts";
import type { ReactElement } from "react";

import type { DesignFoundationPreviewLocale } from "../design-foundations";
import { UiInteractionLab } from "./ui-interaction-lab";
import { uiInteractionsCopyForLocale } from "./ui-interactions-copy";
import styles from "./ui-interactions-specimen.module.css";

export function UiInteractionsSpecimen({
  locale,
}: Readonly<{
  locale: DesignFoundationPreviewLocale;
}>): ReactElement {
  const copy = uiInteractionsCopyForLocale(locale);
  const initialLanguage: SupportedLocale = locale === "en-XA" ? "en" : locale;

  return (
    <main
      className={styles["specimen"]}
      data-font-profile={copy.fontProfile}
      data-theme="editorial-dark"
      data-ui-interactions="v1"
      lang={locale}
    >
      <header className={styles["masthead"]} lang="en">
        <p>Foundation 04 / interaction layers</p>
        <p>{locale}</p>
      </header>

      <section
        className={styles["intro"]}
        aria-labelledby="interaction-heading"
      >
        <p className={styles["eyebrow"]} lang="en">
          Internal accessible interaction specimen
        </p>
        <h1 id="interaction-heading">{copy.heading}</h1>
        <p>{copy.intro}</p>
      </section>

      <UiInteractionLab
        copy={copy}
        initialLanguage={initialLanguage}
        previewLocale={locale}
      />

      <footer className={styles["footer"]} lang="en">
        <p>Internal specimen — not customer content</p>
        <p>Dialog · Drawer · Menu · Toast · Locale / Region</p>
      </footer>
    </main>
  );
}
