"use client";

import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { useEffect, useRef, useState, type ReactElement } from "react";

import { Icon } from "./icon.js";

export type MenuOption<Value extends string = string> = Readonly<{
  detail?: string;
  disabled?: boolean;
  label: string;
  value: Value;
}>;

export type MenuProps<Value extends string = string> = Readonly<{
  label: string;
  onValueChange: (value: Value) => void;
  options: readonly MenuOption<Value>[];
  value: Value;
}>;

const MENU_SCROLL_LOCK_ATTRIBUTE = "data-fs-menu-scroll-lock";
const activeMenuScrollLocks = new Set<symbol>();

function useMenuScrollLock(open: boolean): void {
  const lock = useRef(Symbol("menu-scroll-lock"));

  useEffect(() => {
    if (!open) {
      return;
    }

    const root = document.documentElement;
    const currentLock = lock.current;
    activeMenuScrollLocks.add(currentLock);
    root.setAttribute(MENU_SCROLL_LOCK_ATTRIBUTE, "");

    return () => {
      activeMenuScrollLocks.delete(currentLock);
      if (activeMenuScrollLocks.size === 0) {
        root.removeAttribute(MENU_SCROLL_LOCK_ATTRIBUTE);
      }
    };
  }, [open]);
}

function validateOptions<Value extends string>(
  label: string,
  options: readonly MenuOption<Value>[],
  value: Value,
): MenuOption<Value> {
  if (label.trim() === "") {
    throw new TypeError("Menu label must not be empty");
  }
  if (options.length === 0) {
    throw new TypeError("Menu requires at least one option");
  }

  const values = new Set<string>();
  for (const option of options) {
    if (option.value.trim() === "" || option.label.trim() === "") {
      throw new TypeError("Menu option values and labels must not be empty");
    }
    if (values.has(option.value)) {
      throw new TypeError("Menu option values must be unique");
    }
    values.add(option.value);
  }

  const selected = options.find((option) => option.value === value);
  if (selected === undefined || selected.disabled) {
    throw new TypeError("Menu selected value must match an enabled option");
  }

  return selected;
}

export function Menu<Value extends string>({
  label,
  onValueChange,
  options,
  value,
}: MenuProps<Value>): ReactElement {
  const [open, setOpen] = useState(false);
  useMenuScrollLock(open);
  const selected = validateOptions(label, options, value);

  return (
    <MenuPrimitive.Root loopFocus modal onOpenChange={setOpen} open={open}>
      <MenuPrimitive.Trigger className="fs-menu__trigger">
        <span className="fs-menu__trigger-copy">
          <span className="fs-menu__label">{label}</span>
          <span className="fs-menu__value">{selected.label}</span>
          {selected.detail === undefined ? null : (
            <span className="fs-menu__detail">{selected.detail}</span>
          )}
        </span>
        <span aria-hidden="true" className="fs-menu__chevron">
          <Icon
            className="fs-interaction-icon"
            decorative
            name="chevron-down"
          />
        </span>
      </MenuPrimitive.Trigger>
      <MenuPrimitive.Portal>
        <MenuPrimitive.Positioner
          align="start"
          className="fs-menu__positioner"
          sideOffset={8}
        >
          <MenuPrimitive.Popup aria-label={label} className="fs-menu__popup">
            <MenuPrimitive.RadioGroup
              onValueChange={(nextValue) => {
                const matched = options.find(
                  (option) => option.value === nextValue && !option.disabled,
                );
                if (matched !== undefined) {
                  onValueChange(matched.value);
                }
              }}
              value={value}
            >
              {options.map((option) => (
                <MenuPrimitive.RadioItem
                  className="fs-menu__item"
                  closeOnClick
                  disabled={option.disabled}
                  key={option.value}
                  label={option.label}
                  value={option.value}
                >
                  <MenuPrimitive.RadioItemIndicator
                    className="fs-menu__indicator"
                    keepMounted
                  >
                    <Icon
                      className="fs-interaction-icon"
                      decorative
                      name="check"
                    />
                  </MenuPrimitive.RadioItemIndicator>
                  <span className="fs-menu__item-copy">
                    <span className="fs-menu__item-label">{option.label}</span>
                    {option.detail === undefined ? null : (
                      <span className="fs-menu__item-detail">
                        {option.detail}
                      </span>
                    )}
                  </span>
                </MenuPrimitive.RadioItem>
              ))}
            </MenuPrimitive.RadioGroup>
          </MenuPrimitive.Popup>
        </MenuPrimitive.Positioner>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Root>
  );
}
