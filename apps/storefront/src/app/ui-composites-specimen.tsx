import { currencySchema, minorAmountSchema } from "@fan-support/contracts";
import {
  CartLine,
  GiftTile,
  Hero,
  IdolContext,
  IdolPortrait,
  OrderTimeline,
  type CompositeMedia,
} from "@fan-support/ui/composites";
import type { ReactElement, ReactNode } from "react";

import type { DesignFoundationPreviewLocale } from "../design-foundations";
import { UiCompositesCartLineDemo } from "./ui-composites-cart-line-demo";
import { uiCompositesCopyForLocale } from "./ui-composites-copy";
import { UiCompositesHeroFailureDemo } from "./ui-composites-hero-failure-demo";
import { UiCompositesHeroTransitionDemo } from "./ui-composites-hero-transition-demo";
import styles from "./ui-composites-specimen.module.css";

const AMOUNT_MINOR = minorAmountSchema.parse(12_900);
const CURRENCY = currencySchema.parse("USD");
const INTENTIONALLY_INVALID_IMAGE = "data:image/png;base64,AA==";

function portraitMedia(
  alt: string,
  fallbackLabel: string,
  runtimeFailure = false,
): CompositeMedia {
  return {
    alt,
    fallbackLabel,
    focalPoint: { x: 0.5, y: 0.3 },
    height: 1_402,
    src: runtimeFailure
      ? INTENTIONALLY_INVALID_IMAGE
      : "/ui-composites/fictional-performer-hero-mobile.png",
    state: "ready",
    width: 1_122,
  };
}

function giftMedia(
  alt: string,
  fallbackLabel: string,
  runtimeFailure = false,
): CompositeMedia {
  return {
    alt,
    fallbackLabel,
    focalPoint: { x: 0.5, y: 0.5 },
    height: 1_254,
    src: runtimeFailure
      ? INTENTIONALLY_INVALID_IMAGE
      : "/ui-composites/fictional-keepsake-gift.png",
    state: "ready",
    width: 1_254,
  };
}

function SectionHeading({
  description,
  title,
}: Readonly<{ description: string; title: string }>): ReactElement {
  return (
    <div className={styles["sectionHeading"]} lang="en">
      <p>{description}</p>
      <h2>{title}</h2>
    </div>
  );
}

function StateCell({
  children,
  label,
}: Readonly<{ children: ReactNode; label: string }>): ReactElement {
  return (
    <div className={styles["stateCell"]}>
      <p className={styles["stateLabel"]} lang="en">
        {label}
      </p>
      {children}
    </div>
  );
}

function StateGallery({
  copy,
}: Readonly<{
  copy: ReturnType<typeof uiCompositesCopyForLocale>["copy"];
}>): ReactElement {
  const common = {
    empty: {
      description: copy.emptyDescription,
      state: "empty" as const,
      title: copy.emptyTitle,
    },
    error: {
      action: { href: "#state-gallery", label: copy.action },
      description: copy.errorDescription,
      state: "error" as const,
      title: copy.errorTitle,
    },
    loading: { label: copy.loading, state: "loading" as const },
  };

  return (
    <div className={styles["stateGrid"]} id="state-gallery">
      <StateCell label="Hero / loading">
        <Hero {...common.loading} />
      </StateCell>
      <StateCell label="Hero / empty">
        <Hero {...common.empty} />
      </StateCell>
      <StateCell label="Hero / error">
        <Hero {...common.error} />
      </StateCell>
      <StateCell label="IdolPortrait / loading">
        <IdolPortrait {...common.loading} />
      </StateCell>
      <StateCell label="IdolPortrait / empty">
        <IdolPortrait {...common.empty} />
      </StateCell>
      <StateCell label="IdolPortrait / error">
        <IdolPortrait {...common.error} />
      </StateCell>
      <StateCell label="GiftTile / loading">
        <GiftTile {...common.loading} />
      </StateCell>
      <StateCell label="GiftTile / empty">
        <GiftTile {...common.empty} />
      </StateCell>
      <StateCell label="GiftTile / error">
        <GiftTile {...common.error} />
      </StateCell>
      <StateCell label="IdolContext / loading">
        <IdolContext {...common.loading} />
      </StateCell>
      <StateCell label="IdolContext / empty">
        <IdolContext {...common.empty} />
      </StateCell>
      <StateCell label="IdolContext / error">
        <IdolContext {...common.error} />
      </StateCell>
      <StateCell label="CartLine / loading">
        <CartLine {...common.loading} />
      </StateCell>
      <StateCell label="CartLine / empty">
        <CartLine {...common.empty} />
      </StateCell>
      <StateCell label="CartLine / error">
        <CartLine {...common.error} />
      </StateCell>
      <StateCell label="OrderTimeline / loading">
        <OrderTimeline {...common.loading} />
      </StateCell>
      <StateCell label="OrderTimeline / empty">
        <OrderTimeline {...common.empty} />
      </StateCell>
      <StateCell label="OrderTimeline / error">
        <OrderTimeline {...common.error} />
      </StateCell>
    </div>
  );
}

export function UiCompositesSpecimen({
  locale,
}: Readonly<{
  locale: DesignFoundationPreviewLocale;
}>): ReactElement {
  const { copy, fontProfile, presentationLocale } =
    uiCompositesCopyForLocale(locale);
  const price = {
    amountMinor: AMOUNT_MINOR,
    currency: CURRENCY,
    locale: presentationLocale,
  };
  const readyPortrait = portraitMedia(copy.portraitAlt, copy.portraitFallback);
  const failedPortrait = portraitMedia(
    copy.portraitAlt,
    copy.portraitFallback,
    true,
  );
  const readyGift = giftMedia(copy.giftAlt, copy.giftFallback);
  const failedGift = giftMedia(copy.giftAlt, copy.giftFallback, true);

  return (
    <main
      className={styles["specimen"]}
      data-font-profile={fontProfile}
      data-theme="editorial-dark"
      data-ui-composites="v1"
      lang={locale}
    >
      <header className={styles["masthead"]} lang="en">
        <p>Foundation 04 / Composite gallery</p>
        <p>{locale}</p>
      </header>

      <div className={styles["intro"]}>
        <p className={styles["eyebrow"]} lang="en">
          Product code, preview-only
        </p>
        <p className={styles["title"]} lang="en">
          Composite gallery
        </p>
        <p>{copy.intro}</p>
      </div>

      <div className={styles["heroFrame"]}>
        <Hero
          action={{ href: "#catalog", label: copy.action }}
          description={copy.heroDescription}
          eyebrow={copy.heroEyebrow}
          heading={copy.heroHeading}
          media={{
            alt: copy.heroAlt,
            desktop: {
              focalPoint: { x: 0.74, y: 0.44 },
              height: 941,
              sizes: "100vw",
              src: "/ui-composites/fictional-performer-hero-desktop.png",
              width: 1_672,
            },
            fallbackLabel: copy.heroFallback,
            mobile: {
              focalPoint: { x: 0.5, y: 0.3 },
              height: 1_402,
              sizes: "100vw",
              src: "/ui-composites/fictional-performer-hero-mobile.png",
              width: 1_122,
            },
            state: "ready",
          }}
          state="ready"
          textTone="light"
        />
      </div>

      <section className={styles["section"]} id="catalog">
        <SectionHeading
          description="Selection and availability stay visible without generic card chrome."
          title="Portrait, gift and recipient context"
        />
        <div className={styles["catalogGrid"]}>
          <IdolPortrait
            availability={{ kind: "accepting", label: copy.accepting }}
            href="#recipient"
            media={readyPortrait}
            name="Mira Vale"
            selectedLabel={copy.selected}
            selection="selected"
            state="ready"
          />
          <IdolPortrait
            availability={{ kind: "unavailable", label: copy.paused }}
            media={failedPortrait}
            name="Noa Arden"
            selection="unselected"
            state="ready"
          />
          <GiftTile
            availability={{ kind: "low-stock", label: copy.lowStock }}
            href="#cart"
            media={readyGift}
            price={price}
            state="ready"
            subtitle={copy.giftSubtitle}
            title={copy.giftTitle}
          />
          <GiftTile
            availability={{ kind: "unavailable", label: copy.unavailable }}
            href="#catalog"
            media={failedGift}
            price={price}
            state="ready"
            title={copy.giftTitle}
          />
        </div>
        <div className={styles["contextGrid"]} id="recipient">
          <IdolContext
            action={{ href: "#catalog", label: copy.changeIdol }}
            availability={{ kind: "accepting", label: copy.accepting }}
            contextLabel={copy.contextLabel}
            media={readyPortrait}
            name="Mira Vale"
            state="ready"
          />
          <IdolContext
            availability={{ kind: "unavailable", label: copy.paused }}
            contextLabel={copy.contextLabel}
            media={failedPortrait}
            name="Mira Vale"
            state="ready"
          />
        </div>
      </section>

      <section className={styles["section"]} id="cart">
        <SectionHeading
          description="Only public projection facts are rendered; private message content never enters this fixture."
          title="Cart and fulfillment context"
        />
        <div className={styles["commerceGrid"]}>
          <div>
            <UiCompositesCartLineDemo
              controlId={`cart-line-quantity-${locale}`}
              copy={copy}
              giftMedia={readyGift}
              idolMedia={readyPortrait}
              price={price}
            />
            <CartLine
              availability={{ kind: "unavailable", label: copy.unavailable }}
              gift={{ media: failedGift, title: copy.giftTitle }}
              idol={{
                contextLabel: copy.forLabel,
                media: readyPortrait,
                name: "Mira Vale",
              }}
              lineTotal={price}
              message={{ kind: "none", label: copy.noNote }}
              quantity={{ label: copy.quantity, value: 1 }}
              state="ready"
            />
          </div>
          <OrderTimeline
            label={copy.orderProgress}
            state="ready"
            steps={[
              {
                key: "paid",
                label: copy.paid,
                moment: {
                  dateTime: "2026-09-04T12:00:00Z",
                  label: new Intl.DateTimeFormat(presentationLocale, {
                    dateStyle: "medium",
                    timeZone: "UTC",
                  }).format(new Date("2026-09-04T12:00:00Z")),
                },
                state: "completed",
                stateLabel: copy.stateCompleted,
              },
              {
                key: "preparing",
                label: copy.preparing,
                state: "current",
                stateLabel: copy.stateCurrent,
              },
              {
                key: "delivered",
                label: copy.delivered,
                state: "upcoming",
                stateLabel: copy.stateUpcoming,
              },
            ]}
          />
        </div>
      </section>

      <section className={styles["section"]}>
        <SectionHeading
          description="Every server composition keeps loading, empty and error output deterministic."
          title="Loading, empty and error matrix"
        />
        <StateGallery copy={copy} />
      </section>

      <section className={styles["imageFailure"]}>
        <SectionHeading
          description="The loading and ready Hero reserve the same narrow-screen frame so async content cannot push the catalog downward."
          title="Responsive hero loading transition"
        />
        <UiCompositesHeroTransitionDemo
          actionLabel={copy.action}
          description={copy.heroDescription}
          eyebrow={copy.heroEyebrow}
          heading={copy.heroHeading}
          loadingLabel={copy.loading}
          media={{
            alt: copy.heroAlt,
            desktop: {
              focalPoint: { x: 0.74, y: 0.44 },
              height: 941,
              src: "/ui-composites/fictional-performer-hero-desktop.png",
              width: 1_672,
            },
            fallbackLabel: copy.heroFallback,
            mobile: {
              focalPoint: { x: 0.5, y: 0.3 },
              height: 1_402,
              src: "/ui-composites/fictional-performer-hero-mobile.png",
              width: 1_122,
            },
            state: "ready",
          }}
        />
      </section>

      <section className={styles["imageFailure"]}>
        <SectionHeading
          description="The five media-bearing composites preserve their frame and localized alternative. OrderTimeline has no media by design."
          title="Responsive hero image failure"
        />
        <UiCompositesHeroFailureDemo
          actionLabel={copy.action}
          description={copy.heroDescription}
          eyebrow={copy.heroEyebrow}
          failedMedia={{
            alt: copy.heroAlt,
            desktop: {
              focalPoint: { x: 0.74, y: 0.44 },
              height: 941,
              src: INTENTIONALLY_INVALID_IMAGE,
              width: 1_672,
            },
            fallbackLabel: copy.heroFallback,
            mobile: {
              focalPoint: { x: 0.5, y: 0.3 },
              height: 1_402,
              src: INTENTIONALLY_INVALID_IMAGE,
              width: 1_122,
            },
            state: "ready",
          }}
          heading={copy.heroHeading}
          readyMedia={{
            alt: copy.heroAlt,
            desktop: {
              focalPoint: { x: 0.74, y: 0.44 },
              height: 941,
              src: "/ui-composites/fictional-performer-hero-desktop.png",
              width: 1_672,
            },
            fallbackLabel: copy.heroFallback,
            mobile: {
              focalPoint: { x: 0.5, y: 0.3 },
              height: 1_402,
              src: "/ui-composites/fictional-performer-hero-mobile.png",
              width: 1_122,
            },
            state: "ready",
          }}
        />
      </section>

      <footer className={styles["footer"]} lang="en">
        <p>Internal specimen — fictional content, not customer data</p>
        <p>OrderTimeline media failure: not applicable</p>
      </footer>
    </main>
  );
}
