import type { ReactElement } from "react";

import type { DesignFoundationPreviewLocale } from "../design-foundations";
import { uiMotionCopyForLocale } from "./ui-motion-copy";
import { UiMotionLab } from "./ui-motion-lab";
import styles from "./ui-motion-specimen.module.css";

export function UiMotionSpecimen({
  locale,
}: Readonly<{
  locale: DesignFoundationPreviewLocale;
}>): ReactElement {
  const { copy, fontProfile } = uiMotionCopyForLocale(locale);

  return (
    <main
      className={styles["specimen"]}
      data-font-profile={fontProfile}
      data-ui-motion="v1"
      lang={locale}
    >
      <header className={styles["masthead"]} lang="en">
        <p>Signature motion · P2-05</p>
        <p>CSS + React · no commerce authority</p>
      </header>
      <div className={styles["intro"]}>
        <p className={styles["eyebrow"]}>{copy.fixtureLabel}</p>
        <p>{copy.fixtureDescription}</p>
      </div>
      <UiMotionLab copy={copy} fontProfile={fontProfile} locale={locale} />
      <footer className={styles["footer"]} lang="en">
        <p>Fictional content · preview only · no payment proof</p>
      </footer>
    </main>
  );
}
