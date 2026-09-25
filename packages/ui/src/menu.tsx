"use client";

import {
  Menu as MenuPrimitive,
  type MenuRootChangeEventDetails,
} from "@base-ui/react/menu";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type Ref,
} from "react";

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
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  triggerRef?: Ref<HTMLButtonElement>;
  initialFocus?: "first" | "last";
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
    const preventOutsideTouchScroll = (event: TouchEvent) => {
      const insidePopup = event
        .composedPath()
        .some(
          (target) =>
            target instanceof Element &&
            target.classList.contains("fs-menu__popup"),
        );
      if (!insidePopup) {
        event.preventDefault();
      }
    };
    activeMenuScrollLocks.add(currentLock);
    root.setAttribute(MENU_SCROLL_LOCK_ATTRIBUTE, "");
    document.addEventListener("touchmove", preventOutsideTouchScroll, {
      passive: false,
    });

    return () => {
      document.removeEventListener("touchmove", preventOutsideTouchScroll);
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
  open: controlledOpen,
  onOpenChange,
  triggerRef,
  initialFocus,
}: MenuProps<Value>): ReactElement {
  const [internalOpen, setOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const triggerId = useId();
  const trigger = useRef<HTMLButtonElement | null>(null);
  const initialFocusQueued = useRef(false);
  const cancelInitialFocus = useRef<(() => void) | null>(null);
  useEffect(() => () => cancelInitialFocus.current?.(), []);
  useEffect(() => {
    if (!open) {
      cancelInitialFocus.current?.();
      initialFocusQueued.current = false;
    }
  }, [open]);
  useMenuScrollLock(open);
  const selected = validateOptions(label, options, value);
  const handleOpenChange = (
    nextOpen: boolean,
    eventDetails: MenuRootChangeEventDetails,
  ) => {
    if (
      !nextOpen &&
      eventDetails.reason === "outside-press" &&
      eventDetails.event.type === "touchmove"
    ) {
      eventDetails.cancel();
      return;
    }
    if (controlledOpen === undefined) setOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  return (
    <MenuPrimitive.Root
      loopFocus
      modal
      onOpenChange={handleOpenChange}
      open={open}
      {...(controlledOpen === undefined ? {} : { triggerId })}
    >
      <MenuPrimitive.Trigger
        className="fs-menu__trigger"
        {...(controlledOpen === undefined ? {} : { id: triggerId })}
        ref={(node: HTMLButtonElement | null) => {
          trigger.current = node;
          if (typeof triggerRef === "function") return triggerRef(node);
          else if (triggerRef) triggerRef.current = node;
        }}
      >
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
          <MenuPrimitive.Popup
            aria-label={label}
            className="fs-menu__popup"
            ref={(node: HTMLDivElement | null) => {
              cancelInitialFocus.current?.();
              if (!node || !open || !initialFocus || initialFocusQueued.current)
                return;
              initialFocusQueued.current = true;
              let canceled = false;
              const cancel = () => {
                canceled = true;
              };
              window.addEventListener("keydown", cancel, true);
              window.addEventListener("pointerdown", cancel, true);
              const clear = () => {
                window.removeEventListener("keydown", cancel, true);
                window.removeEventListener("pointerdown", cancel, true);
              };
              const frame = requestAnimationFrame(() => {
                clear();
                if (
                  canceled ||
                  !node.isConnected ||
                  (document.activeElement !== trigger.current &&
                    !node.contains(document.activeElement))
                )
                  return;
                const items = [
                  ...node.querySelectorAll<HTMLElement>(
                    '[role="menuitemradio"]:not([aria-disabled="true"])',
                  ),
                ];
                (initialFocus === "last" ? items.at(-1) : items[0])?.focus();
              });
              cancelInitialFocus.current = () => {
                cancel();
                clear();
                cancelAnimationFrame(frame);
              };
            }}
          >
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
