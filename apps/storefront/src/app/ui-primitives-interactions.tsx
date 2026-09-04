"use client";

import { useState, type ReactElement } from "react";

import { Button, Field } from "@fan-support/ui";
import { Media, Quantity } from "@fan-support/ui/client";

import type { UiPrimitiveCopy } from "./ui-primitives-copy";
import styles from "./ui-primitives-specimen.module.css";

export function UiPrimitiveInteractions({
  copy,
}: Readonly<{ copy: UiPrimitiveCopy }>): ReactElement {
  const [actionCount, setActionCount] = useState(0);
  const [mediaErrorRequested, setMediaErrorRequested] = useState(false);
  const [quantity, setQuantity] = useState(2);
  const [rtlQuantity, setRtlQuantity] = useState(2);

  return (
    <>
      <section className={styles["panel"]} aria-labelledby="actions-heading">
        <h2 id="actions-heading" lang="en">
          Button states
        </h2>
        <div className={styles["controlRow"]}>
          <Button
            data-testid="primary-action"
            onClick={() => setActionCount((count) => count + 1)}
          >
            {copy.action}
          </Button>
          <Button disabled variant="secondary">
            {copy.disabledAction}
          </Button>
          <Button loading variant="quiet">
            {copy.loadingAction}
          </Button>
        </div>
        <p data-button-count={actionCount}>
          {copy.buttonCount}: {actionCount}
        </p>
      </section>

      <section className={styles["panel"]} aria-labelledby="media-heading">
        <h2 id="media-heading" lang="en">
          Media states
        </h2>
        <Button
          data-testid="media-error-trigger"
          onClick={() => setMediaErrorRequested(true)}
          variant="quiet"
        >
          {copy.mediaErrorAction}
        </Button>
        <div className={styles["mediaGrid"]}>
          <Media
            alt={copy.mediaAlt}
            fallbackLabel={copy.mediaFallback}
            height={1_000}
            src="/ui-primitives-media.svg"
            width={800}
          />
          <Media
            alt={copy.mediaAlt}
            fallbackLabel={copy.mediaFallback}
            height={1_000}
            src={
              mediaErrorRequested
                ? "data:image/png;base64,SGVsbG8="
                : "/ui-primitives-media.svg"
            }
            width={800}
          />
        </div>
      </section>

      <section
        className={styles["panel"]}
        id="primitive-form"
        aria-labelledby="form-heading"
      >
        <h2 id="form-heading" lang="en">
          Field and quantity
        </h2>
        <div className={styles["formGrid"]}>
          <Field
            error={copy.fieldError}
            hint={copy.fieldHint}
            id="primitive-display-name"
            label={copy.fieldLabel}
          />
          <Quantity
            decreaseLabel={copy.decrease}
            id="primitive-quantity"
            increaseLabel={copy.increase}
            label={copy.quantity}
            max={5}
            min={1}
            onValueChange={setQuantity}
            value={quantity}
          />
        </div>
      </section>

      <section
        className={styles["panel"]}
        data-rtl-probe="true"
        dir="rtl"
        aria-labelledby="rtl-heading"
      >
        <h2 id="rtl-heading" lang="en">
          RTL structure probe
        </h2>
        <Quantity
          decreaseLabel={copy.decrease}
          id="rtl-primitive-quantity"
          increaseLabel={copy.increase}
          label={copy.quantity}
          max={5}
          min={1}
          onValueChange={setRtlQuantity}
          value={rtlQuantity}
        />
      </section>
    </>
  );
}
