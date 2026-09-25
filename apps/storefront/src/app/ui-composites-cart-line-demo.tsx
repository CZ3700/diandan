"use client";

import { minorAmountSchema } from "@fan-support/contracts";
import type {
  CompositeMedia,
  CompositeMoney,
} from "@fan-support/ui/composites";
import { InteractiveCartLine } from "@fan-support/ui/composites-client";
import { Button } from "@fan-support/ui";
import { useState, type ReactElement } from "react";

import type { UiCompositesCopy } from "./ui-composites-copy";

export function UiCompositesCartLineDemo({
  controlId,
  copy,
  giftMedia,
  idolMedia,
  price,
}: Readonly<{
  controlId: string;
  copy: UiCompositesCopy;
  giftMedia: CompositeMedia;
  idolMedia: CompositeMedia;
  price: CompositeMoney;
}>): ReactElement {
  const [quantity, setQuantity] = useState(2);
  const [removed, setRemoved] = useState(false);
  const lineTotal = {
    ...price,
    amountMinor: minorAmountSchema.parse(price.amountMinor * quantity),
  };

  if (removed) {
    return (
      <div className="fs-cart-line-demo__removed">
        <p aria-live="polite" role="status">
          {copy.giftRemoved}
        </p>
        <Button onClick={() => setRemoved(false)} variant="secondary">
          {copy.restoreGift}
        </Button>
      </div>
    );
  }

  return (
    <InteractiveCartLine
      availability={{ kind: "available", label: copy.accepting }}
      editAction={{ href: "#cart", label: copy.editNote }}
      gift={{
        href: "#catalog",
        media: giftMedia,
        title: copy.giftTitle,
        variantLabel: copy.giftSubtitle,
      }}
      idol={{
        contextLabel: copy.forLabel,
        media: idolMedia,
        name: "Mira Vale",
      }}
      lineTotal={lineTotal}
      message={{ kind: "present", label: copy.noteAdded }}
      onQuantityChange={setQuantity}
      onRemove={() => setRemoved(true)}
      quantity={{
        decreaseLabel: copy.decreaseQuantity,
        id: controlId,
        increaseLabel: copy.increaseQuantity,
        label: copy.quantity,
        max: 5,
        min: 1,
        value: quantity,
      }}
      removeLabel={copy.removeGift}
    />
  );
}
