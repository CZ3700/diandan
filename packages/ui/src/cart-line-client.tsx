"use client";

import type { ReactElement } from "react";

import { CartLineLayout, type CartLineReadyProps } from "./cart-line.js";
import { Button } from "./button.js";
import { Quantity, type QuantityProps } from "./quantity.js";

type InteractiveQuantity = Omit<QuantityProps, "className" | "onValueChange">;

export type InteractiveCartLineProps = Omit<CartLineReadyProps, "quantity"> &
  Readonly<{
    onQuantityChange: (value: number) => void;
    onRemove: () => void;
    quantity: InteractiveQuantity;
    removeDisabled?: boolean;
    removeLabel: string;
    removePending?: boolean;
  }>;

export function InteractiveCartLine({
  onQuantityChange,
  onRemove,
  quantity,
  removeDisabled = false,
  removeLabel,
  removePending = false,
  ...props
}: InteractiveCartLineProps): ReactElement {
  if (!Number.isSafeInteger(quantity.min) || quantity.min <= 0) {
    throw new RangeError(
      "InteractiveCartLine quantity requires a positive minimum.",
    );
  }

  return (
    <CartLineLayout
      props={{
        ...props,
        quantity: { label: quantity.label, value: quantity.value },
      }}
      quantityControl={
        <Quantity
          {...quantity}
          className="fs-cart-line__quantity"
          onValueChange={onQuantityChange}
        />
      }
      removeControl={
        <Button
          className="fs-cart-line__remove"
          data-cart-line-action="remove"
          disabled={removeDisabled}
          loading={removePending}
          onClick={onRemove}
          size="compact"
          variant="danger"
        >
          {removeLabel}
        </Button>
      }
    />
  );
}
