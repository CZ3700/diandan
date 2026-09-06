"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";
import {
  currencySchema,
  LOCALE_NATIVE_NAMES,
  minorAmountSchema,
  SUPPORTED_LOCALES,
} from "@fan-support/contracts";
import { FONT_PROFILE_BY_LOCALE } from "@fan-support/design-tokens";
import { Button, Icon, Price } from "@fan-support/ui";
import { Media } from "@fan-support/ui/client";
import { Dialog, Drawer } from "@fan-support/ui/interactions";
import type { DesignFoundationPreviewLocale } from "../design-foundations";
import { brandCopyForLocale, type BrandCopy } from "./ui-brand-copy";
import {
  addBrandGift,
  BRAND_ARTISTS,
  BRAND_CATEGORIES,
  BRAND_GIFTS,
  createBrandState,
  selectBrandArtist,
  visibleBrandGifts,
  type BrandGift,
  type BrandState,
} from "./ui-brand-model";
import styles from "./ui-brand-specimen.module.css";

const PREVIEW_CURRENCY = currencySchema.parse("USD");

function HeadingPhrases({ text }: Readonly<{ text: string }>) {
  return text.split(/(?<=，)/u).map((phrase) => (
    <span className={styles["headingPhrase"]} key={phrase}>
      {phrase}
    </span>
  ));
}

function GiftImage({
  gift,
  copy,
  title,
}: Readonly<{ gift: BrandGift; copy: BrandCopy; title: string }>) {
  return (
    <Media
      className={styles["giftImage"] ?? ""}
      src={gift.image}
      width={gift.size}
      height={gift.size}
      alt={title}
      fallbackLabel={copy.mediaFallback}
    />
  );
}

export function UiBrandSpecimen({
  locale,
  initialState = createBrandState(),
}: Readonly<{
  locale: DesignFoundationPreviewLocale;
  initialState?: BrandState;
}>): ReactElement {
  const copy = brandCopyForLocale(locale);
  const presentationLocale = locale === "en-XA" ? "en" : locale;
  const [state, setState] = useState(initialState);
  const [announcement, setAnnouncement] = useState("");
  const [bagOpen, setBagOpen] = useState(false);
  const [heroFailed, setHeroFailed] = useState(false);
  const heroImageRef = useRef<HTMLImageElement>(null);
  const [openGift, setOpenGift] = useState<string | null>(null);
  const artist =
    BRAND_ARTISTS.find((candidate) => candidate.id === state.artistId) ??
    BRAND_ARTISTS[0];
  const count = state.lines.reduce((sum, line) => sum + line.quantity, 0);
  const total = state.lines.reduce(
    (sum, line) =>
      sum +
      (BRAND_GIFTS.find((g) => g.id === line.giftId)?.amountMinor ?? 0) *
        line.quantity,
    0,
  );

  useEffect(() => {
    const image = heroImageRef.current;
    if (image?.complete === true && image.naturalWidth === 0) {
      setHeroFailed(true);
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const previousLang = root.lang;
    const previousProfile = root.getAttribute("data-font-profile");
    root.lang = locale;
    root.setAttribute(
      "data-font-profile",
      FONT_PROFILE_BY_LOCALE[presentationLocale].id,
    );
    return () => {
      root.lang = previousLang;
      if (previousProfile === null) root.removeAttribute("data-font-profile");
      else root.setAttribute("data-font-profile", previousProfile);
    };
  }, [locale, presentationLocale]);

  const money = (amount: number) => (
    <Price
      amountMinor={minorAmountSchema.parse(amount)}
      currency={PREVIEW_CURRENCY}
      locale={presentationLocale}
    />
  );
  const add = (gift: BrandGift) => {
    setState((current) => addBrandGift(current, gift.id));
    setAnnouncement(`${copy.added} · ${artist.name}`);
  };

  return (
    <div
      className={styles["specimen"]}
      lang={locale}
      data-ui-brand="v2"
      data-font-profile={FONT_PROFILE_BY_LOCALE[presentationLocale].id}
    >
      <div className={styles["preview"]}>{copy.preview}</div>
      <header className={styles["header"]}>
        <a
          className={styles["wordmark"]}
          href="#top"
          lang="en"
          aria-label="Fan Support"
        >
          FAN SUPPORT<span aria-hidden="true">.</span>
        </a>
        <nav className={styles["navigation"]} aria-label={copy.navGifts}>
          <a href="#artists">{copy.navArtists}</a>
          <a href="#gifts">{copy.navGifts}</a>
          <a href="#how">{copy.navHow}</a>
        </nav>
        <div className={styles["utilities"]}>
          <label className={styles["language"]}>
            <span className={styles["srOnly"]}>{copy.language}</span>
            <select
              aria-label={copy.language}
              value={locale}
              onChange={(event) => {
                const next = event.currentTarget.value;
                if (!SUPPORTED_LOCALES.some((candidate) => candidate === next))
                  return;
                const params = new URLSearchParams({
                  demo: JSON.stringify(state),
                });
                window.location.assign(
                  `/_internal/design-foundations/${next}/brand?${params.toString()}`,
                );
              }}
            >
              {locale === "en-XA" && <option value="en-XA">Pseudo</option>}
              {SUPPORTED_LOCALES.map((code) => (
                <option key={code} value={code}>
                  {LOCALE_NATIVE_NAMES[code]}
                </option>
              ))}
            </select>
          </label>
          <div className={styles["bagTrigger"]} data-brand-bag="true">
            <Drawer
              open={bagOpen}
              onOpenChange={setBagOpen}
              title={copy.bag}
              description={copy.bagHint}
              closeLabel={copy.close}
              triggerLabel={
                <>
                  <Icon name="shopping-bag" decorative />
                  <span className={styles["srOnly"]}>{copy.bag}</span>
                  <span data-brand-count={count}>{count}</span>
                </>
              }
            >
              <div className={styles["bagContent"]} data-brand-cart="true">
                {state.lines.length === 0 ? (
                  <p>{copy.emptyBag}</p>
                ) : (
                  state.lines.map((line) => {
                    const giftIndex = BRAND_GIFTS.findIndex(
                      (g) => g.id === line.giftId,
                    );
                    const gift = BRAND_GIFTS[giftIndex];
                    const recipient = BRAND_ARTISTS.find(
                      (a) => a.id === line.artistId,
                    );
                    if (gift === undefined || recipient === undefined)
                      return null;
                    return (
                      <div
                        className={styles["bagLine"]}
                        key={`${line.artistId}:${line.giftId}`}
                      >
                        <GiftImage
                          gift={gift}
                          copy={copy}
                          title={copy.giftNames[giftIndex] ?? ""}
                        />
                        <div>
                          <p>{copy.giftNames[giftIndex]}</p>
                          <p className={styles["muted"]}>
                            {copy.forArtist} {recipient.name} · {line.quantity}
                          </p>
                          {money(gift.amountMinor * line.quantity)}
                          <Button
                            variant="quiet"
                            aria-label={`${copy.remove} · ${copy.giftNames[giftIndex]} · ${recipient.name}`}
                            onClick={() =>
                              setState((current) => ({
                                ...current,
                                lines: current.lines.filter(
                                  (candidate) =>
                                    candidate.artistId !== line.artistId ||
                                    candidate.giftId !== line.giftId,
                                ),
                              }))
                            }
                          >
                            {copy.remove}
                          </Button>
                        </div>
                      </div>
                    );
                  })
                )}
                <div className={styles["bagTotal"]}>
                  <span>{copy.total}</span>
                  {money(total)}
                </div>
                <p className={styles["muted"]}>{copy.previewCheckout}</p>
                <Button onClick={() => setBagOpen(false)}>
                  {copy.continueBrowsing}
                </Button>
              </div>
            </Drawer>
          </div>
        </div>
      </header>

      <main id="top">
        <section className={styles["hero"]} aria-labelledby="brand-title">
          <div className={styles["heroCopy"]}>
            <p className={styles["eyebrow"]}>{copy.heroEyebrow}</p>
            <h1 id="brand-title">
              <HeadingPhrases text={copy.heroTitle} />
            </h1>
            <p className={styles["heroBody"]}>{copy.heroBody}</p>
            <div className={styles["heroActions"]}>
              <a className={styles["primaryLink"]} href="#gifts">
                {copy.heroAction}
                <Icon name="arrow-right" decorative />
              </a>
              <a className={styles["textLink"]} href="#artists">
                {copy.heroSecondary}
              </a>
            </div>
            <div className={styles["heroCaption"]}>
              <span>{copy.featured}</span>
              <strong>Kai Ren</strong>
              <span aria-hidden="true">01 / 03</span>
            </div>
          </div>
          <div className={styles["heroPhoto"]}>
            {heroFailed ? (
              <div
                className={styles["heroFallback"]}
                role="img"
                aria-label={`Kai Ren · ${copy.mediaFallback}`}
              >
                {copy.mediaFallback}
              </div>
            ) : (
              <picture>
                <source
                  media="(min-width: 48rem)"
                  srcSet="/ui-brand/performer-daylight-desktop.webp"
                  width={1641}
                  height={958}
                />
                {/* Native picture selects one art-directed resource; the current Media primitive has no picture-source API. */}
                <img
                  ref={heroImageRef}
                  src="/ui-brand/performer-daylight-mobile.webp"
                  width={1122}
                  height={1402}
                  alt="Kai Ren"
                  fetchPriority="high"
                  loading="eager"
                  onError={() => setHeroFailed(true)}
                />
              </picture>
            )}
          </div>
        </section>

        <section
          className={styles["artistsSection"]}
          id="artists"
          aria-labelledby="artists-title"
        >
          <div className={styles["sectionHeading"]}>
            <div>
              <p className={styles["eyebrow"]}>{copy.artistEyebrow}</p>
              <h2 id="artists-title">{copy.artistTitle}</h2>
            </div>
            <p>{copy.artistBody}</p>
          </div>
          <fieldset className={styles["artists"]}>
            <legend className={styles["srOnly"]}>{copy.chooseArtist}</legend>
            {BRAND_ARTISTS.map((person) => (
              <label
                className={styles["artist"]}
                key={person.id}
                data-selected={state.artistId === person.id}
              >
                <input
                  type="radio"
                  name="brand-artist"
                  value={person.id}
                  aria-label={person.name}
                  checked={state.artistId === person.id}
                  onChange={() => {
                    setState((current) =>
                      selectBrandArtist(current, person.id),
                    );
                    setAnnouncement(`${copy.selected} · ${person.name}`);
                  }}
                />
                <div className={styles["artistPhoto"]}>
                  <Media
                    src={person.image}
                    width={person.width}
                    height={person.height}
                    alt={person.name}
                    fallbackLabel={copy.mediaFallback}
                    focalPoint={{ x: 0.5, y: 0.3 }}
                  />
                </div>
                <div className={styles["artistCaption"]}>
                  <strong>{person.name}</strong>
                  <span>
                    {state.artistId === person.id
                      ? copy.selected
                      : copy.chooseArtist}
                    <Icon
                      decorative
                      name={
                        state.artistId === person.id ? "check" : "arrow-right"
                      }
                    />
                  </span>
                </div>
              </label>
            ))}
          </fieldset>
        </section>

        <section
          className={styles["giftsSection"]}
          id="gifts"
          aria-labelledby="gifts-title"
        >
          <div className={styles["sectionHeading"]}>
            <div>
              <p className={styles["eyebrow"]}>{copy.giftEyebrow}</p>
              <h2 id="gifts-title">
                <HeadingPhrases text={copy.giftTitle} />
              </h2>
            </div>
            <p>{copy.giftBody}</p>
          </div>
          <div className={styles["giftToolbar"]}>
            <div
              className={styles["filters"]}
              role="group"
              aria-label={copy.navGifts}
            >
              {BRAND_CATEGORIES.map((category, index) => (
                <button
                  key={category}
                  type="button"
                  aria-pressed={state.category === category}
                  onClick={() =>
                    setState((current) => ({ ...current, category }))
                  }
                >
                  {copy.categories[index]}
                </button>
              ))}
            </div>
            <p className={styles["recipient"]}>
              {copy.forArtist} <strong>{artist.name}</strong>
              <Icon name="check" decorative />
            </p>
          </div>
          <div className={styles["gifts"]} data-brand-grid="true">
            {visibleBrandGifts(state.category).map((gift) => {
              const index = BRAND_GIFTS.findIndex((g) => g.id === gift.id);
              const title = copy.giftNames[index] ?? "";
              const description = copy.giftDescriptions[index] ?? "";
              const quantity =
                state.lines.find(
                  (line) =>
                    line.artistId === state.artistId && line.giftId === gift.id,
                )?.quantity ?? 0;
              return (
                <article
                  className={styles["gift"]}
                  key={gift.id}
                  data-brand-gift={gift.id}
                >
                  <Dialog
                    open={openGift === gift.id}
                    onOpenChange={(open) => {
                      setOpenGift(open ? gift.id : null);
                      setAnnouncement("");
                    }}
                    title={title}
                    description={description}
                    closeLabel={copy.close}
                    triggerLabel={
                      <>
                        <span className={styles["giftVisual"]}>
                          <span aria-hidden="true">
                            <GiftImage gift={gift} copy={copy} title={title} />
                          </span>
                          <span className={styles["giftOpen"]}>
                            <Icon name="plus" decorative />
                            <span className={styles["srOnly"]}>
                              {copy.viewGift}
                            </span>
                          </span>
                        </span>
                        <span className={styles["giftName"]}>{title}</span>
                        <span className={styles["giftPrice"]}>
                          {money(gift.amountMinor)}
                        </span>
                      </>
                    }
                  >
                    <div className={styles["giftDetail"]}>
                      <GiftImage gift={gift} copy={copy} title={title} />
                      <div className={styles["detailSummary"]}>
                        <p>
                          {copy.forArtist} <strong>{artist.name}</strong>
                        </p>
                        {money(gift.amountMinor)}
                      </div>
                      <Button
                        disabled={quantity >= 5}
                        onClick={() => add(gift)}
                      >
                        {quantity >= 5 ? copy.quantityLimit : copy.add}
                        <Icon decorative name="plus" />
                      </Button>
                      <p role="status" aria-live="polite">
                        {announcement && (
                          <>
                            {announcement}
                            <br />
                            {copy.giftCount}: {quantity}
                          </>
                        )}
                      </p>
                      <p className={styles["muted"]}>{copy.previewCheckout}</p>
                    </div>
                  </Dialog>
                </article>
              );
            })}
          </div>
        </section>

        <section
          className={styles["howSection"]}
          id="how"
          aria-labelledby="how-title"
        >
          <h2 id="how-title">{copy.howTitle}</h2>
          <ol>
            {copy.howSteps.map((step, index) => (
              <li key={step}>
                <span className={styles["stepNumber"]}>0{index + 1}</span>
                <h3>{step}</h3>
                <p>{copy.howBodies[index]}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>
      <footer className={styles["footer"]}>
        <span className={styles["wordmark"]} lang="en">
          FAN SUPPORT<span aria-hidden="true">.</span>
        </span>
        <p>{copy.footer}</p>
        <a href="#artists">
          <Icon name="arrow-left" decorative />
          {copy.heroSecondary}
        </a>
      </footer>
      <div className={styles["srOnly"]} role="status" aria-live="polite">
        {openGift === null ? announcement : ""}
      </div>
    </div>
  );
}
