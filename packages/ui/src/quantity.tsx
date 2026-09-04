"use client";

import type { ChangeEvent, KeyboardEvent, ReactElement } from "react";

import { Icon } from "./icon.js";

export type QuantityAction = "decrease" | "increase" | "maximum" | "minimum";

export type QuantityProps = Readonly<{
  className?: string;
  decreaseLabel: string;
  disabled?: boolean;
  id: string;
  increaseLabel: string;
  label: string;
  max: number;
  min: number;
  name?: string;
  onValueChange: (value: number) => void;
  step?: number;
  value: number;
  valueLabel?: string;
}>;

function classNames(...values: ReadonlyArray<string | undefined>): string {
  return values
    .filter((value): value is string => value !== undefined)
    .join(" ");
}

function isAlignedToStep(value: number, min: number, step: number): boolean {
  return (BigInt(value) - BigInt(min)) % BigInt(step) === 0n;
}

function validateQuantity(
  value: number,
  min: number,
  max: number,
  step: number,
): void {
  if (
    !Number.isSafeInteger(value) ||
    !Number.isSafeInteger(min) ||
    !Number.isSafeInteger(max)
  ) {
    throw new RangeError("Quantity value, min, and max must be safe integers.");
  }
  if (!Number.isSafeInteger(step) || step <= 0) {
    throw new RangeError("Quantity step must be a positive safe integer.");
  }
  if (min > max) {
    throw new RangeError("Quantity min must not be greater than max.");
  }
  if (value < min || value > max) {
    throw new RangeError("Quantity value must be between min and max.");
  }
  if (!isAlignedToStep(max, min, step)) {
    throw new RangeError("Quantity max must align with min and step.");
  }
  if (!isAlignedToStep(value, min, step)) {
    throw new RangeError("Quantity value must align with min and step.");
  }
}

function validateNonEmptyText(name: string, value: string): void {
  if (value.trim().length === 0) {
    throw new TypeError(`Quantity ${name} must be non-empty.`);
  }
}

function actionForKey(key: string): QuantityAction | undefined {
  switch (key) {
    case "ArrowDown":
      return "decrease";
    case "ArrowUp":
      return "increase";
    case "End":
      return "maximum";
    case "Home":
      return "minimum";
    default:
      return undefined;
  }
}

export function getNextQuantityValue(
  value: number,
  action: QuantityAction,
  min: number,
  max: number,
  step: number,
): number {
  switch (action) {
    case "decrease":
      return Math.max(min, value - step);
    case "increase":
      return Math.min(max, value + step);
    case "maximum":
      return max;
    case "minimum":
      return min;
  }
}

export function Quantity({
  className,
  decreaseLabel,
  disabled = false,
  id,
  increaseLabel,
  label,
  max,
  min,
  name,
  onValueChange,
  step = 1,
  value,
  valueLabel,
}: QuantityProps): ReactElement {
  validateNonEmptyText("id", id);
  validateNonEmptyText("label", label);
  validateNonEmptyText("decreaseLabel", decreaseLabel);
  validateNonEmptyText("increaseLabel", increaseLabel);
  if (valueLabel !== undefined) {
    validateNonEmptyText("valueLabel", valueLabel);
  }
  validateQuantity(value, min, max, step);

  const emitAction = (action: QuantityAction): void => {
    if (disabled) {
      return;
    }
    const nextValue = getNextQuantityValue(value, action, min, max, step);
    if (nextValue !== value) {
      onValueChange(nextValue);
    }
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    if (disabled || event.currentTarget.value.trim().length === 0) {
      return;
    }
    const nextValue = Number(event.currentTarget.value);
    if (!Number.isSafeInteger(nextValue)) {
      return;
    }
    const clampedValue = Math.min(max, Math.max(min, nextValue));
    if (!isAlignedToStep(clampedValue, min, step)) {
      return;
    }
    if (clampedValue !== value) {
      onValueChange(clampedValue);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (disabled) {
      return;
    }
    const action = actionForKey(event.key);
    if (action === undefined) {
      return;
    }
    event.preventDefault();
    emitAction(action);
  };

  return (
    <div
      className={classNames("fs-quantity", className)}
      data-disabled={disabled || undefined}
    >
      <label htmlFor={id} className="fs-quantity__label">
        {label}
      </label>
      <div className="fs-quantity__controls" dir="ltr">
        <button
          aria-controls={id}
          aria-label={decreaseLabel}
          className="fs-quantity__button fs-quantity__button--decrease"
          data-quantity-action="decrease"
          disabled={disabled || value <= min}
          onClick={() => emitAction("decrease")}
          type="button"
        >
          <Icon decorative name="minus" />
        </button>
        <input
          id={id}
          type="number"
          role="spinbutton"
          aria-valuemax={max}
          aria-valuemin={min}
          aria-valuenow={value}
          aria-valuetext={valueLabel}
          className="fs-quantity__input"
          data-quantity-input
          disabled={disabled}
          max={max}
          min={min}
          name={name}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          step={step}
          value={value}
        />
        <button
          aria-controls={id}
          aria-label={increaseLabel}
          className="fs-quantity__button fs-quantity__button--increase"
          data-quantity-action="increase"
          disabled={disabled || value >= max}
          onClick={() => emitAction("increase")}
          type="button"
        >
          <Icon decorative name="plus" />
        </button>
      </div>
    </div>
  );
}
