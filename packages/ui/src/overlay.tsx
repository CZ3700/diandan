"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type { ReactElement, ReactNode } from "react";

import { Icon } from "./icon.js";

export type DialogProps = Readonly<{
  actions?: ReactNode;
  children?: ReactNode;
  closeLabel: string;
  defaultOpen?: boolean;
  description: ReactNode;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  title: ReactNode;
  triggerLabel: ReactNode;
}>;

export type DrawerSide = "block-end" | "inline-end" | "inline-start";

export type DrawerProps = DialogProps &
  Readonly<{
    side?: DrawerSide;
  }>;

type ModalSurfaceProps = DialogProps &
  Readonly<{
    kind: "dialog" | "drawer";
    side?: DrawerSide;
  }>;

function requireAccessibleCopy(
  triggerLabel: ReactNode,
  title: ReactNode,
  description: ReactNode,
  closeLabel: string,
): void {
  const isMissingCopy = (value: ReactNode): boolean =>
    value === null ||
    value === undefined ||
    value === false ||
    (typeof value === "string" && value.trim() === "");

  if (isMissingCopy(triggerLabel)) {
    throw new TypeError("Dialog trigger label is required");
  }
  if (isMissingCopy(title)) {
    throw new TypeError("Dialog title is required");
  }
  if (isMissingCopy(description)) {
    throw new TypeError("Dialog description is required");
  }
  if (closeLabel.trim() === "") {
    throw new TypeError("Dialog close label is required");
  }
}

function ModalSurface({
  actions,
  children,
  closeLabel,
  defaultOpen,
  description,
  kind,
  onOpenChange,
  open,
  side,
  title,
  triggerLabel,
}: ModalSurfaceProps): ReactElement {
  requireAccessibleCopy(triggerLabel, title, description, closeLabel);
  const drawerSide = side ?? "inline-end";

  return (
    <DialogPrimitive.Root
      defaultOpen={defaultOpen}
      modal
      onOpenChange={(nextOpen) => onOpenChange?.(nextOpen)}
      open={open}
    >
      <DialogPrimitive.Trigger
        className="fs-overlay-trigger"
        data-overlay-trigger={kind}
      >
        {triggerLabel}
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fs-overlay__backdrop" />
        <DialogPrimitive.Viewport
          className="fs-overlay__viewport"
          data-overlay-kind={kind}
          data-side={kind === "drawer" ? drawerSide : undefined}
        >
          <DialogPrimitive.Popup
            className={
              kind === "drawer" ? "fs-drawer__popup" : "fs-dialog__popup"
            }
            data-overlay-popup={kind}
            data-side={kind === "drawer" ? drawerSide : undefined}
          >
            <header className="fs-overlay__header">
              <div className="fs-overlay__intro">
                <DialogPrimitive.Title className="fs-overlay__title">
                  {title}
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="fs-overlay__description">
                  {description}
                </DialogPrimitive.Description>
              </div>
              <DialogPrimitive.Close
                aria-label={closeLabel}
                className="fs-overlay__close"
              >
                <Icon className="fs-interaction-icon" decorative name="close" />
              </DialogPrimitive.Close>
            </header>
            {children === undefined ? null : (
              <div className="fs-overlay__body">{children}</div>
            )}
            {actions === undefined ? null : (
              <footer className="fs-overlay__actions">{actions}</footer>
            )}
          </DialogPrimitive.Popup>
        </DialogPrimitive.Viewport>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function Dialog(props: DialogProps): ReactElement {
  return <ModalSurface {...props} kind="dialog" />;
}

export function Drawer({
  side = "inline-end",
  ...props
}: DrawerProps): ReactElement {
  return <ModalSurface {...props} kind="drawer" side={side} />;
}
