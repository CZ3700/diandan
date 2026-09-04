import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import {
  getNextQuantityValue,
  Quantity,
  type QuantityProps,
} from "./quantity.js";

type TestProps = Readonly<{
  children?: ReactNode;
  disabled?: boolean;
  onChange?: unknown;
  onClick?: unknown;
  onKeyDown?: unknown;
  type?: unknown;
  [key: string]: unknown;
}>;

type TestElement = ReactElement<TestProps>;

function quantityProps(overrides: Partial<QuantityProps> = {}): QuantityProps {
  return {
    decreaseLabel: "Decrease quantity",
    id: "gift-quantity",
    increaseLabel: "Increase quantity",
    label: "Quantity",
    max: 5,
    min: 1,
    onValueChange: vi.fn(),
    value: 2,
    ...overrides,
  };
}

function findElement(
  node: ReactNode,
  predicate: (element: TestElement) => boolean,
): TestElement {
  let match: TestElement | undefined;

  function visit(candidate: ReactNode): void {
    if (match !== undefined || candidate === null || candidate === undefined) {
      return;
    }
    if (Array.isArray(candidate)) {
      for (const child of candidate) {
        visit(child);
      }
      return;
    }
    if (!isValidElement(candidate)) {
      return;
    }

    const element = candidate as TestElement;
    if (predicate(element)) {
      match = element;
      return;
    }
    visit(element.props.children as ReactNode);
  }

  visit(node);
  if (match === undefined) {
    throw new Error("Expected element was not found");
  }
  return match;
}

function control(root: ReactElement, action: "decrease" | "increase") {
  return findElement(
    root,
    (element) => element.props["data-quantity-action"] === action,
  );
}

function spinbutton(root: ReactElement) {
  return findElement(
    root,
    (element) => element.props["data-quantity-input"] === true,
  );
}

describe("Quantity", () => {
  test("renders labeled native controls with stable RTL-independent order", () => {
    const markup = renderToStaticMarkup(
      <div dir="rtl">
        <Quantity
          {...quantityProps({
            decreaseLabel: "减少数量",
            increaseLabel: "增加数量",
            label: "数量",
          })}
        />
      </div>,
    );

    expect(markup).toContain('<label for="gift-quantity"');
    expect(markup).toContain("数量");
    expect(markup).toContain('dir="ltr"');
    expect(markup).toMatch(
      /<button[^>]+aria-label="减少数量"[^>]+type="button"/u,
    );
    expect(markup).toMatch(
      /<input[^>]+id="gift-quantity"[^>]+type="number"[^>]+role="spinbutton"/u,
    );
    expect(markup).toContain('min="1"');
    expect(markup).toContain('max="5"');
    expect(markup).toContain('step="1"');
    expect(markup).toContain('aria-valuenow="2"');
    expect(markup.match(/<svg\b/gu)).toHaveLength(2);
    expect(markup).not.toContain(">−<");
    expect(markup).not.toContain(">+<");
    expect(markup).toMatch(
      /<button[^>]+aria-label="增加数量"[^>]+type="button"/u,
    );
  });

  test("buttons update from the controlled value and clamp at boundaries", () => {
    const onValueChange = vi.fn();
    const root = Quantity(
      quantityProps({ max: 7, min: 1, onValueChange, step: 3, value: 4 }),
    );

    const decrease = control(root, "decrease");
    const increase = control(root, "increase");
    expect(decrease.props.type).toBe("button");
    expect(increase.props.type).toBe("button");

    (decrease.props.onClick as () => void)();
    (increase.props.onClick as () => void)();

    expect(onValueChange.mock.calls).toEqual([[1], [7]]);
  });

  test.each([
    ["ArrowUp", 7],
    ["ArrowDown", 1],
    ["Home", 1],
    ["End", 7],
  ] as const)(
    "maps %s without depending on text direction",
    (key, expected) => {
      const onValueChange = vi.fn();
      const preventDefault = vi.fn();
      const root = Quantity(
        quantityProps({ max: 7, onValueChange, step: 3, value: 4 }),
      );
      const input = spinbutton(root);

      (
        input.props.onKeyDown as (event: {
          key: string;
          preventDefault: () => void;
        }) => void
      )({ key, preventDefault });

      expect(preventDefault).toHaveBeenCalledOnce();
      expect(onValueChange).toHaveBeenCalledWith(expected);
    },
  );

  test("does not emit boundary no-ops and marks the blocked button disabled", () => {
    const atMinimum = vi.fn();
    const minimumRoot = Quantity(
      quantityProps({ onValueChange: atMinimum, value: 1 }),
    );
    const decrease = control(minimumRoot, "decrease");
    const input = spinbutton(minimumRoot);

    expect(decrease.props.disabled).toBe(true);
    (decrease.props.onClick as () => void)();
    (
      input.props.onKeyDown as (event: {
        key: string;
        preventDefault: () => void;
      }) => void
    )({ key: "ArrowDown", preventDefault: vi.fn() });
    expect(atMinimum).not.toHaveBeenCalled();

    const maximumRoot = Quantity(quantityProps({ value: 5 }));
    expect(control(maximumRoot, "increase").props.disabled).toBe(true);
  });

  test("supports direct integer input while clamping min and max", () => {
    const onValueChange = vi.fn();
    const root = Quantity(quantityProps({ onValueChange }));
    const input = spinbutton(root);
    const onChange = input.props.onChange as (event: {
      currentTarget: { value: string };
    }) => void;

    onChange({ currentTarget: { value: "99" } });
    onChange({ currentTarget: { value: "-8" } });
    onChange({ currentTarget: { value: "2.5" } });
    onChange({ currentTarget: { value: "" } });

    expect(onValueChange.mock.calls).toEqual([[5], [1]]);
  });

  test("ignores direct integer input that is outside the configured step lattice", () => {
    const onValueChange = vi.fn();
    const root = Quantity(
      quantityProps({ max: 7, min: 1, onValueChange, step: 3, value: 4 }),
    );
    const input = spinbutton(root);

    (
      input.props.onChange as (event: {
        currentTarget: { value: string };
      }) => void
    )({ currentTarget: { value: "5" } });

    expect(onValueChange).not.toHaveBeenCalled();
  });

  test("disabled prevents pointer, keyboard and direct-input updates", () => {
    const onValueChange = vi.fn();
    const root = Quantity(quantityProps({ disabled: true, onValueChange }));
    const decrease = control(root, "decrease");
    const increase = control(root, "increase");
    const input = spinbutton(root);

    expect(decrease.props.disabled).toBe(true);
    expect(increase.props.disabled).toBe(true);
    expect(input.props.disabled).toBe(true);

    (decrease.props.onClick as () => void)();
    (increase.props.onClick as () => void)();
    (
      input.props.onKeyDown as (event: {
        key: string;
        preventDefault: () => void;
      }) => void
    )({ key: "End", preventDefault: vi.fn() });
    (
      input.props.onChange as (event: {
        currentTarget: { value: string };
      }) => void
    )({ currentTarget: { value: "4" } });

    expect(onValueChange).not.toHaveBeenCalled();
  });

  test("requires safe integer bounds, values and positive steps", () => {
    expect(() => Quantity(quantityProps({ step: 0 }))).toThrow(
      /positive safe integer/u,
    );
    expect(() => Quantity(quantityProps({ step: 1.5 }))).toThrow(
      /positive safe integer/u,
    );
    expect(() => Quantity(quantityProps({ min: 6 }))).toThrow(/min.*max/u);
    expect(() => Quantity(quantityProps({ value: 6 }))).toThrow(
      /between min and max/u,
    );
    expect(() => Quantity(quantityProps({ step: 3 }))).toThrow(/max.*step/u);
    expect(() =>
      Quantity(quantityProps({ max: 5, step: 2, value: 2 })),
    ).toThrow(/value.*step/u);
    expect(() =>
      Quantity(quantityProps({ max: Number.MAX_SAFE_INTEGER + 1 })),
    ).toThrow(/safe integers/u);
    expect(() =>
      Quantity(
        quantityProps({
          max: Number.MAX_SAFE_INTEGER - 1,
          min: Number.MIN_SAFE_INTEGER,
          step: 2,
          value: Number.MIN_SAFE_INTEGER,
        }),
      ),
    ).toThrow(/max.*step/u);
  });

  test("exposes deterministic clamped transitions", () => {
    expect(getNextQuantityValue(4, "increase", 1, 7, 3)).toBe(7);
    expect(getNextQuantityValue(4, "decrease", 1, 7, 3)).toBe(1);
    expect(getNextQuantityValue(3, "minimum", 1, 5, 1)).toBe(1);
    expect(getNextQuantityValue(3, "maximum", 1, 5, 1)).toBe(5);
  });

  test.each([
    ["id", { id: "   " }],
    ["label", { label: "" }],
    ["decreaseLabel", { decreaseLabel: "  " }],
    ["increaseLabel", { increaseLabel: "\t" }],
    ["valueLabel", { valueLabel: "  " }],
  ] as const)("rejects an empty %s", (_name, override) => {
    expect(() => Quantity(quantityProps(override))).toThrow(/non-empty/u);
  });
});
