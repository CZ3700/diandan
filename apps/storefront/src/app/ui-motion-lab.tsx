"use client";

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";

import { Button } from "@fan-support/ui";
import { Hero } from "@fan-support/ui/composites";
import {
  AddToCartConfirmation,
  IdolSwitcher,
  type AddToCartStatus,
  type IdolSwitchItem,
} from "@fan-support/ui/motion-client";
import { HeroEntrance, SuccessReveal } from "@fan-support/ui/motion";

import type { DesignFoundationPreviewLocale } from "../design-foundations";
import type { UiMotionCopy } from "./ui-motion-copy";
import styles from "./ui-motion-specimen.module.css";

const MIRA_MEDIA = {
  focalPoint: { x: 0.5, y: 0.26 },
  height: 1_402,
  src: "/ui-composites/fictional-performer-hero-mobile.png",
  state: "ready",
  width: 1_122,
} as const;

const NOA_MEDIA = {
  focalPoint: { x: 0.49, y: 0.28 },
  height: 1_402,
  src: "/ui-motion/fictional-performer-noa-aster.webp",
  state: "ready",
  width: 1_122,
} as const;

export function UiMotionLab({
  copy,
  fontProfile,
  locale,
}: Readonly<{
  copy: UiMotionCopy;
  fontProfile: string;
  locale: DesignFoundationPreviewLocale;
}>): ReactElement {
  const [heroRevision, setHeroRevision] = useState(0);
  const [successRevision, setSuccessRevision] = useState(0);
  const [addStatus, setAddStatus] = useState<AddToCartStatus>("idle");
  const [cartCount, setCartCount] = useState(0);
  const confirmationTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const root = document.documentElement;
    const previousLanguage = root.getAttribute("lang");
    const previousProfile = root.getAttribute("data-font-profile");
    root.setAttribute("lang", locale);
    root.setAttribute("data-font-profile", fontProfile);
    return () => {
      if (previousLanguage === null) {
        root.removeAttribute("lang");
      } else {
        root.setAttribute("lang", previousLanguage);
      }
      if (previousProfile === null) {
        root.removeAttribute("data-font-profile");
      } else {
        root.setAttribute("data-font-profile", previousProfile);
      }
    };
  }, [fontProfile, locale]);

  useEffect(
    () => () => {
      if (confirmationTimer.current !== undefined) {
        window.clearTimeout(confirmationTimer.current);
      }
    },
    [],
  );

  const idols = useMemo(
    () =>
      [
        {
          description: copy.miraDescription,
          id: "mira-vale",
          media: {
            ...MIRA_MEDIA,
            alt: copy.miraAlt,
            fallbackLabel: copy.mediaFallback,
          },
          name: "Mira Vale",
        },
        {
          description: copy.noaDescription,
          id: "noa-aster",
          media: {
            ...NOA_MEDIA,
            alt: copy.noaAlt,
            fallbackLabel: copy.mediaFallback,
          },
          name: "Noa Aster",
        },
      ] satisfies readonly IdolSwitchItem[],
    [copy],
  );

  function addGift(): void {
    if (confirmationTimer.current !== undefined) {
      window.clearTimeout(confirmationTimer.current);
    }
    setAddStatus("pending");
    confirmationTimer.current = window.setTimeout(() => {
      setCartCount((current) => current + 1);
      setAddStatus("confirmed");
      confirmationTimer.current = undefined;
    }, 48);
  }

  function resetConfirmation(): void {
    if (confirmationTimer.current !== undefined) {
      window.clearTimeout(confirmationTimer.current);
      confirmationTimer.current = undefined;
    }
    setAddStatus("idle");
  }

  function showError(): void {
    if (confirmationTimer.current !== undefined) {
      window.clearTimeout(confirmationTimer.current);
      confirmationTimer.current = undefined;
    }
    setAddStatus("error");
  }

  const announcement =
    addStatus === "error"
      ? copy.addErrorAnnouncement
      : `${copy.addAnnouncement}: ${String(cartCount)}`;

  return (
    <div data-motion-fixture="true">
      <section className={styles["heroSection"]}>
        <HeroEntrance key={heroRevision}>
          <Hero
            action={{ href: "#idol-motion", label: copy.heroAction }}
            description={copy.heroDescription}
            eyebrow={copy.heroEyebrow}
            heading={copy.heroHeading}
            media={{
              alt: copy.miraAlt,
              desktop: {
                focalPoint: { x: 0.72, y: 0.4 },
                height: 900,
                sizes: "100vw",
                src: "/ui-composites/fictional-performer-hero-desktop.png",
                width: 1_600,
              },
              fallbackLabel: copy.mediaFallback,
              mobile: MIRA_MEDIA,
              state: "ready",
            }}
            state="ready"
            textTone="light"
          />
        </HeroEntrance>
        <Button
          data-testid="replay-hero"
          onClick={() => setHeroRevision((current) => current + 1)}
          variant="quiet"
        >
          {copy.replayHero}
        </Button>
      </section>

      <section className={styles["section"]} id="idol-motion">
        <IdolSwitcher
          initialId="mira-vale"
          items={idols}
          label={copy.idolLegend}
          selectedLabel={copy.selected}
        />
      </section>

      <section className={styles["section"]}>
        <div className={styles["sectionHeading"]}>
          <h2>{copy.addHeading}</h2>
          <p>{copy.addBody}</p>
        </div>
        <div className={styles["actionDemo"]}>
          <AddToCartConfirmation
            announcement={announcement}
            confirmedLabel={copy.addConfirmed}
            errorLabel={copy.addError}
            label={copy.addLabel}
            onAdd={addGift}
            pendingLabel={copy.addPending}
            status={addStatus}
          />
          <output data-cart-count={cartCount}>
            {copy.cartCount}: {cartCount}
          </output>
          <div className={styles["controls"]}>
            <Button onClick={resetConfirmation} variant="secondary">
              {copy.reset}
            </Button>
            <Button onClick={showError} variant="quiet">
              {copy.showError}
            </Button>
          </div>
        </div>
      </section>

      <section className={styles["section"]}>
        <SuccessReveal
          description={copy.successDescription}
          key={successRevision}
          status="confirmed"
          title={copy.successTitle}
        >
          <p>{copy.successOrder}</p>
          <p>{copy.successNext}</p>
        </SuccessReveal>
        <Button
          data-testid="replay-success"
          onClick={() => setSuccessRevision((current) => current + 1)}
          variant="quiet"
        >
          {copy.replaySuccess}
        </Button>
      </section>
    </div>
  );
}
