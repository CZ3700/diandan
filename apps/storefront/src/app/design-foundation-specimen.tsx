import type { CSSProperties, ReactElement } from "react";

import { resolveIdolAccent } from "@fan-support/design-tokens";

import {
  DESIGN_FOUNDATION_CASES,
  type DesignFoundationPreviewLocale,
} from "../design-foundations";
import styles from "./design-foundation-specimen.module.css";

const PALETTE = Object.freeze([
  ["Canvas", "--color-bg"],
  ["Surface", "--color-surface"],
  ["Raised", "--color-surface-raised"],
  ["Accent", "--color-accent"],
  ["Success", "--color-success"],
  ["Warning", "--color-warning"],
  ["Danger", "--color-danger"],
] as const);

export function DesignFoundationSpecimen({
  accent,
  locale,
}: Readonly<{
  accent?: unknown;
  locale: DesignFoundationPreviewLocale;
}>): ReactElement {
  const specimen = DESIGN_FOUNDATION_CASES[locale];
  const resolvedAccent = resolveIdolAccent(accent ?? specimen.accent);
  const accentStyle = resolvedAccent.style as CSSProperties;

  return (
    <main
      className={styles["specimen"]}
      data-accent-fallback={String(resolvedAccent.fallbackUsed)}
      data-design-foundations="v1"
      data-font-profile={specimen.fontProfile}
      data-theme="editorial-dark"
      style={accentStyle}
    >
      <header className={styles["masthead"]}>
        <p>Foundation 02 / Typography &amp; Color</p>
        <p>{locale}</p>
      </header>

      <section
        className={styles["poster"]}
        lang={locale}
        aria-labelledby="foundation-heading"
      >
        <div className={styles["posterCopy"]}>
          <p className={styles["eyebrow"]}>{specimen.label}</p>
          <h1 id="foundation-heading">{specimen.heading}</h1>
          <p className={styles["bodyCopy"]}>{specimen.body}</p>
        </div>

        <div className={styles["typeProof"]}>
          <p>{specimen.sample}</p>
          <p className={styles["numerals"]}>0123456789</p>
        </div>
      </section>

      <section
        className={styles["systemGrid"]}
        aria-labelledby="system-heading"
      >
        <div className={styles["systemIntro"]}>
          <p className={styles["eyebrow"]}>Responsive foundation</p>
          <h2 id="system-heading">One rhythm, every script.</h2>
          <p>
            Fluid type and a twelve-column canvas adapt without truncating
            translatable text or coupling language to commerce context.
          </p>
        </div>

        <div className={styles["accentProof"]}>
          <span aria-hidden="true" />
          <div>
            <p>Idol accent</p>
            <p>
              {resolvedAccent.accent} · {resolvedAccent.contrastRatio}:1
            </p>
          </div>
        </div>
      </section>

      <section
        className={styles["paletteSection"]}
        aria-labelledby="palette-heading"
      >
        <div>
          <p className={styles["eyebrow"]}>Semantic palette</p>
          <h2 id="palette-heading">Meaning stays stable.</h2>
        </div>
        <ul className={styles["palette"]}>
          {PALETTE.map(([label, token]) => (
            <li
              key={token}
              style={{ "--swatch": `var(${token})` } as CSSProperties}
            >
              <span aria-hidden="true" />
              <p>{label}</p>
              <code>{token}</code>
            </li>
          ))}
        </ul>
      </section>

      <footer className={styles["footer"]}>
        <p>Internal specimen — not customer content</p>
        <a href="/healthz">Runtime health</a>
      </footer>
    </main>
  );
}
