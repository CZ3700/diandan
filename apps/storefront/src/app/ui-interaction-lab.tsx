"use client";

import type { SupportedLocale } from "@fan-support/contracts";
import { useEffect, useMemo, useState, type ReactElement } from "react";

import { Button } from "@fan-support/ui";
import {
  Dialog,
  Drawer,
  LanguageControl,
  LiveRegion,
  Menu,
  RegionControl,
  ToastProvider,
  useToast,
} from "@fan-support/ui/interactions";

import type { DesignFoundationPreviewLocale } from "../design-foundations";
import { createInternalPresentationLocaleUrl } from "../internal-presentation-locale";
import { serializePresentationLocaleCookie } from "../presentation-locale";
import type { UiInteractionsCopy } from "./ui-interactions-copy";
import styles from "./ui-interactions-specimen.module.css";

const DEFAULT_REGION = "US";

const FIXTURE_REGION_CONTEXT = Object.freeze({
  BR: Object.freeze({ currency: "BRL", market: "Brazil" }),
  CA: Object.freeze({ currency: "CAD", market: "Canada" }),
  US: Object.freeze({ currency: "USD", market: "Americas" }),
});

type TransactionContext = Readonly<{
  amountMinor: string;
  cart: string;
  currency: string;
  market: string;
  paymentAttempt: string;
  region: string;
}>;

function contextFromLocation(copy: UiInteractionsCopy): TransactionContext {
  const parameters = new URL(window.location.href).searchParams;
  const requestedRegion = parameters.get("region") ?? DEFAULT_REGION;
  const region = copy.regions.some((option) => option.value === requestedRegion)
    ? requestedRegion
    : DEFAULT_REGION;
  return {
    amountMinor: parameters.get("amount") ?? "2599",
    cart: parameters.get("cart") ?? "cart_fixture",
    currency: parameters.get("currency") ?? "USD",
    market: parameters.get("market") ?? "Americas",
    paymentAttempt: parameters.get("paymentAttempt") ?? "attempt_fixture",
    region,
  };
}

function ToastDemo({
  copy,
}: Readonly<{ copy: UiInteractionsCopy }>): ReactElement {
  const { notify } = useToast();

  return (
    <div className={styles["actionRow"]}>
      <Button
        data-testid="create-toast"
        onClick={() =>
          notify({
            description: copy.toast.description,
            id: "preference-preview",
            priority: "low",
            title: copy.toast.title,
          })
        }
        variant="secondary"
      >
        {copy.toast.trigger}
      </Button>
      <Button
        data-testid="create-toast-limit"
        onClick={() => {
          for (let index = 1; index <= 4; index += 1) {
            notify({
              description: copy.toast.description,
              id: `limit-preview-${String(index)}`,
              priority: "low",
              title: `${copy.toast.title} ${String(index)}`,
            });
          }
        }}
        variant="quiet"
      >
        <span lang="en">Create four unique notifications</span>
      </Button>
    </div>
  );
}

export function UiInteractionLab({
  copy,
  initialLanguage,
  previewLocale,
}: Readonly<{
  copy: UiInteractionsCopy;
  initialLanguage: SupportedLocale;
  previewLocale: DesignFoundationPreviewLocale;
}>): ReactElement {
  const [density, setDensity] = useState("comfortable");
  const [announcement, setAnnouncement] = useState("");
  const [context, setContext] = useState<TransactionContext>({
    amountMinor: "2599",
    cart: "cart_fixture",
    currency: "USD",
    market: "Americas",
    paymentAttempt: "attempt_fixture",
    region: DEFAULT_REGION,
  });
  const contextJson = useMemo(() => JSON.stringify(context), [context]);

  useEffect(() => {
    const profileAttribute = "data-font-profile";
    const languageAttribute = "lang";
    const root = document.documentElement;
    const previousProfile = root.getAttribute(profileAttribute);
    const previousLanguage = root.getAttribute(languageAttribute);
    root.setAttribute(profileAttribute, copy.fontProfile);
    root.setAttribute(languageAttribute, previewLocale);

    return () => {
      if (previousProfile === null) {
        root.removeAttribute(profileAttribute);
      } else {
        root.setAttribute(profileAttribute, previousProfile);
      }
      if (previousLanguage === null) {
        root.removeAttribute(languageAttribute);
      } else {
        root.setAttribute(languageAttribute, previousLanguage);
      }
    };
  }, [copy.fontProfile, previewLocale]);

  useEffect(() => {
    setContext(contextFromLocation(copy));
  }, [copy]);

  function changeLanguage(locale: SupportedLocale): void {
    if (locale === initialLanguage && previewLocale !== "en-XA") {
      return;
    }
    const destination = createInternalPresentationLocaleUrl(
      new URL(window.location.href),
      locale,
    );
    document.cookie = serializePresentationLocaleCookie(locale, {
      secure: window.location.protocol === "https:",
    });
    window.location.assign(destination);
  }

  function changeRegion(region: string): void {
    const option = copy.regions.find((candidate) => candidate.value === region);
    if (option === undefined || option.disabled) {
      return;
    }
    const regionContext =
      FIXTURE_REGION_CONTEXT[region as keyof typeof FIXTURE_REGION_CONTEXT];
    if (regionContext === undefined) {
      return;
    }
    const { currency, market } = regionContext;
    const nextContext = { ...context, currency, market, region };
    const destination = new URL(window.location.href);
    destination.searchParams.set("region", region);
    destination.searchParams.set("market", market);
    destination.searchParams.set("currency", currency);
    window.history.replaceState(window.history.state, "", destination);
    setContext(nextContext);
    setAnnouncement(`${copy.regionChanged}: ${option.label}`);
  }

  return (
    <ToastProvider
      closeLabel={copy.toast.close}
      limit={3}
      timeout={5_000}
      viewportLabel={copy.toast.viewport}
    >
      <section
        className={styles["workspace"]}
        data-interaction-workspace="dialog"
        aria-labelledby="dialog-workspace-heading"
      >
        <h2 id="dialog-workspace-heading" lang="en">
          Dialog / focus boundary
        </h2>
        <Dialog
          closeLabel={copy.close}
          description={copy.dialog.description}
          title={copy.dialog.title}
          triggerLabel={copy.dialog.trigger}
        >
          <p>{copy.dialog.body}</p>
          <div className={styles["actionRow"]}>
            <Button data-testid="dialog-secondary-action" variant="secondary">
              {copy.menu.options[1]?.label}
            </Button>
            <Button data-testid="dialog-primary-action">
              {copy.menu.options[0]?.label}
            </Button>
          </div>
        </Dialog>
      </section>

      <section
        className={styles["workspace"]}
        data-interaction-workspace="drawer"
        aria-labelledby="drawer-workspace-heading"
      >
        <h2 id="drawer-workspace-heading" lang="en">
          Drawer / edge layer
        </h2>
        <Drawer
          closeLabel={copy.close}
          description={copy.drawer.description}
          side="inline-end"
          title={copy.drawer.title}
          triggerLabel={copy.drawer.trigger}
        >
          <p>{copy.drawer.body}</p>
          <Button data-testid="drawer-action" variant="secondary">
            {copy.menu.options[0]?.label}
          </Button>
        </Drawer>
      </section>

      <section
        className={styles["workspace"]}
        data-interaction-workspace="menu"
        aria-labelledby="menu-workspace-heading"
      >
        <h2 id="menu-workspace-heading" lang="en">
          Menu / keyboard navigation
        </h2>
        <Menu
          label={copy.menu.label}
          onValueChange={setDensity}
          options={copy.menu.options}
          value={density}
        />
      </section>

      <section
        className={styles["workspace"]}
        data-interaction-workspace="toast"
        aria-labelledby="toast-workspace-heading"
      >
        <h2 id="toast-workspace-heading" lang="en">
          Toast / live feedback
        </h2>
        <ToastDemo copy={copy} />
      </section>

      <section
        className={styles["workspace"]}
        data-interaction-workspace="locale-region"
        aria-labelledby="locale-workspace-heading"
      >
        <h2 id="locale-workspace-heading" lang="en">
          Language / region isolation
        </h2>
        <div className={styles["controlGrid"]}>
          <LanguageControl
            label={copy.language}
            onValueChange={changeLanguage}
            value={initialLanguage}
          />
          <RegionControl
            label={copy.region}
            onValueChange={changeRegion}
            options={copy.regions}
            value={context.region}
          />
        </div>
        <dl
          className={styles["context"]}
          data-context-json={contextJson}
          data-testid="transaction-context"
        >
          {Object.entries(context).map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <LiveRegion message={announcement} />
      </section>
    </ToastProvider>
  );
}
