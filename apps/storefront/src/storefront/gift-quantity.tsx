"use client";

import { useId, useState } from "react";
import { Quantity } from "@fan-support/ui/client";

export function GiftQuantity({
  max,
  label,
  decreaseLabel,
  increaseLabel,
}: Readonly<{
  max: number;
  label: string;
  decreaseLabel: string;
  increaseLabel: string;
}>) {
  const id = useId();
  const [quantity, setQuantity] = useState(1);
  return (
    <Quantity
      id={id}
      label={label}
      decreaseLabel={decreaseLabel}
      increaseLabel={increaseLabel}
      min={1}
      max={max}
      value={quantity}
      onValueChange={setQuantity}
    />
  );
}
